import { noulAnswer } from "./request"
import { estimateTokens } from "./state"
import type { JevAsker, JevQuestions } from "./types"

export const DEFAULT_TEST_DELETE_THRESHOLD = 0.1

export const DEFAULT_MAX_TEST_REQUEST_TOKENS = 30_000

export const TEST_STATE_CONTEXT =
	"A repository test suite is being pruned. `tests` lists unit test functions with their source. Each question asks whether one test is worth keeping. A test is not worth keeping when it is empty, asserts nothing meaningful, only repeats another test, or checks something trivially true."

export interface TestFunction {
	id: string
	file: string
	name: string
	start: number
	end: number
	source: string
}

export interface TestDeletion {
	id: string
	file: string
	name: string
	keepTest: number
}

export interface PruneTestsResult {
	files: number
	tests: number
	requests: number
	deleted: TestDeletion[]
	scores: Array<{
		id: string
		file: string
		name: string
		keepTest: number
	}>
}

export interface TestFileAccess {
	list(): Promise<string[]>
	read(path: string): Promise<string>
	write(path: string, text: string): Promise<void>
}

type RawTest = Omit<TestFunction, "id">
type Extractor = (file: string, text: string) => RawTest[]

interface Syntax {
	slashComments: boolean
	hashComments: boolean
	charQuote: boolean
}

const IGNORED_DIRECTORY =
	/(^|\/)(node_modules|dist|build|target|out|bin|obj|vendor|third_party|Pods|\.git|\.gradle|\.build|\.dart_tool|\.next|_build|deps|coverage|__pycache__|venv|\.venv|site-packages)\//

const C_SYNTAX: Syntax = {
	slashComments: true,
	hashComments: false,
	charQuote: false,
}
const CHAR_SYNTAX: Syntax = {
	slashComments: true,
	hashComments: false,
	charQuote: true,
}
const PHP_SYNTAX: Syntax = {
	slashComments: true,
	hashComments: true,
	charQuote: false,
}
const HASH_SYNTAX: Syntax = {
	slashComments: false,
	hashComments: true,
	charQuote: false,
}

const CHAR_LITERAL = /^'(?:\\[^']*|[^\\'\n])'/

function lineStarts(text: string): number[] {
	const starts = [0]
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === "\n") starts.push(i + 1)
	}
	return starts
}

function matchingClose(text: string, open: number, syntax: Syntax): number {
	const opener = text[open]!
	const closer = opener === "(" ? ")" : "}"
	let depth = 0
	let quote = ""
	for (let i = open; i < text.length; i += 1) {
		const char = text[i]!
		const next = text[i + 1]
		if (quote) {
			if (char === "\\") i += 1
			else if (char === quote) quote = ""
			continue
		}
		if (syntax.slashComments && char === "/" && next === "/") {
			const end = text.indexOf("\n", i)
			if (end === -1) return -1
			i = end
		} else if (syntax.slashComments && char === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2)
			if (end === -1) return -1
			i = end + 1
		} else if (syntax.hashComments && char === "#") {
			const end = text.indexOf("\n", i)
			if (end === -1) return -1
			i = end
		} else if (char === "'" && syntax.charQuote) {
			const literal = CHAR_LITERAL.exec(text.slice(i, i + 12))
			if (literal) i += literal[0].length - 1
		} else if (char === '"' || char === "'" || char === "`") quote = char
		else if (char === opener) depth += 1
		else if (char === closer) {
			depth -= 1
			if (depth === 0) return i
		}
	}
	return -1
}

function lineStartOf(text: string, index: number): number {
	return text.lastIndexOf("\n", index - 1) + 1
}

function calls(names: string, syntax: Syntax, trailingBlock = false): Extractor {
	const head = new RegExp(
		`^[ \\t]*(?:${names})(?:\\.(?:only|skip|concurrent|todo|fails|failing|serial))?\\s*\\(\\s*(['"\`])((?:\\\\.|(?!\\1).)*)\\1`,
		"gm",
	)
	return (file, text) => {
		const found: RawTest[] = []
		let cursor = 0
		for (const match of text.matchAll(head)) {
			const start = match.index!
			if (start < cursor) continue
			const open = text.indexOf("(", start)
			const close = matchingClose(text, open, syntax)
			if (close === -1) continue
			let end = close + 1
			if (trailingBlock) {
				let probe = end
				while (text[probe] === " " || text[probe] === "\t") probe += 1
				if (text[probe] === "{") {
					const blockEnd = matchingClose(text, probe, syntax)
					if (blockEnd !== -1) end = blockEnd + 1
				}
			}
			if (text[end] === ";") end += 1
			found.push({
				file,
				name: match[2]!,
				start,
				end,
				source: text.slice(start, end),
			})
			cursor = end
		}
		return found
	}
}

function braced(header: RegExp, syntax: Syntax): Extractor {
	const pattern = new RegExp(header.source, `${header.flags.replace("g", "")}gm`)
	return (file, text) => {
		const found: RawTest[] = []
		let cursor = 0
		for (const match of text.matchAll(pattern)) {
			const start = lineStartOf(text, match.index!)
			if (start < cursor) continue
			const afterHeader = match.index! + match[0].length
			const open = text.indexOf("{", afterHeader)
			if (open === -1 || text.slice(afterHeader, open).includes(";")) continue
			const close = matchingClose(text, open, syntax)
			if (close === -1) continue
			const end = close + 1
			found.push({
				file,
				name: (match.slice(1).find((group) => group !== undefined) ?? "anonymous").trim(),
				start,
				end,
				source: text.slice(start, end),
			})
			cursor = end
		}
		return found
	}
}

function annotated(annotation: RegExp, attribute: RegExp, syntax: Syntax): Extractor {
	const SIGNATURE_NAME = /([\w$]+|`[^`\n]+`)\s*\(/
	return (file, text) => {
		const starts = lineStarts(text)
		const lines = text.split("\n")
		const found: RawTest[] = []
		let cursor = 0
		for (let i = 0; i < lines.length; i += 1) {
			if (!annotation.test(lines[i]!)) continue
			let first = i
			while (first > 0 && attribute.test(lines[first - 1]!)) first -= 1
			let j = i + 1
			while (j < lines.length && attribute.test(lines[j]!)) j += 1
			const start = starts[first]!
			if (start < cursor || j >= lines.length) continue
			const signatureStart = starts[j]!
			const open = text.indexOf("{", signatureStart)
			if (open === -1 || text.slice(signatureStart, open).includes(";")) {
				continue
			}
			const close = matchingClose(text, open, syntax)
			if (close === -1) continue
			const end = close + 1
			const name = SIGNATURE_NAME.exec(text.slice(signatureStart, open))?.[1] ?? "anonymous"
			found.push({ file, name, start, end, source: text.slice(start, end) })
			cursor = end
			const next = starts.findIndex((offset) => offset > end)
			i = next === -1 ? lines.length : next - 1
		}
		return found
	}
}

function indented(header: RegExp, options: { decorators?: boolean; endKeyword?: boolean }): Extractor {
	return (file, text) => {
		const starts = lineStarts(text)
		const lines = text.split("\n")
		const found: RawTest[] = []
		for (let i = 0; i < lines.length; i += 1) {
			const match = header.exec(lines[i]!)
			if (!match) continue
			const indent = lines[i]!.length - lines[i]!.trimStart().length
			let first = i
			if (options.decorators) {
				while (first > 0 && /^\s*@/.test(lines[first - 1]!)) first -= 1
			}
			let last = i
			for (let j = i + 1; j < lines.length; j += 1) {
				const line = lines[j]!
				if (line.trim().length === 0) continue
				const lineIndent = line.length - line.trimStart().length
				if (lineIndent < indent) break
				if (lineIndent === indent) {
					if (options.endKeyword && /^end\b/.test(line.trim())) last = j
					break
				}
				last = j
			}
			const start = starts[first]!
			const end = starts[last]! + lines[last]!.length
			found.push({
				file,
				name: match[1] ?? "anonymous",
				start,
				end,
				source: text.slice(start, end),
			})
			i = last
		}
		return found
	}
}

function combine(...extractors: Extractor[]): Extractor {
	return (file, text) => {
		const all = extractors.flatMap((extract) => extract(file, text))
		all.sort((a, b) => a.start - b.start || b.end - a.end)
		const kept: RawTest[] = []
		let cursor = 0
		for (const test of all) {
			if (test.start < cursor) continue
			kept.push(test)
			cursor = test.end
		}
		return kept
	}
}

const JVM_ANNOTATION = /^\s*@(?:[\w.]+\.)?(?:Test|ParameterizedTest|RepeatedTest|TestFactory|TestTemplate|Theory|Property)\b/
const JVM_ATTRIBUTE = /^\s*@\w/

interface Language {
	files: RegExp
	extract: Extractor
}

const LANGUAGES: Language[] = [
	{
		files: /(^|\/)[^/]+[._](test|spec)\.[cm]?[jt]sx?$|(^|\/)__tests__\/[^/]+\.[cm]?[jt]sx?$/,
		extract: calls("it|test|specify|Deno\\.test", C_SYNTAX),
	},
	{
		files: /(^|\/)(test_[^/]+|[^/]+_test)\.py$/,
		extract: indented(/^\s*(?:async\s+)?def\s+(test\w*)\s*\(/, {
			decorators: true,
		}),
	},
	{
		files: /_test\.go$/,
		extract: braced(/^func\s+(Test\w*)\s*\(/, CHAR_SYNTAX),
	},
	{
		files: /\.rs$/,
		extract: annotated(
			/^\s*#\[(?:[\w:]*::)?(?:test|rstest|test_case|wasm_bindgen_test|quickcheck|proptest)\b/,
			/^\s*#\[/,
			CHAR_SYNTAX,
		),
	},
	{
		files: /(^|\/)src\/[^/]*[tT]est[^/]*\/.+\.(java|kt|kts|scala|groovy)$|(^|\/)[^/]*(Test|Tests|IT|Spec|TestCase)\.(java|kt|kts|scala|groovy)$|(^|\/)Test[^/]*\.(java|kt|scala|groovy)$/,
		extract: combine(
			annotated(JVM_ANNOTATION, JVM_ATTRIBUTE, CHAR_SYNTAX),
			braced(/^[ \t]*(?:public\s+|protected\s+)?(?:void|fun)\s+(test\w*)\s*\(/, CHAR_SYNTAX),
			braced(/^[ \t]*def\s+"((?:\\.|[^"\\\n])*)"\s*\(/, CHAR_SYNTAX),
			calls('test|it|should|"[^"\\n]*"\\s+should', C_SYNTAX, true),
		),
	},
	{
		files: /(^|\/)[^/]*(Test|Tests)\.cs$|(^|\/)[^/]*Tests?\/[^/]+\.cs$/,
		extract: annotated(
			/^\s*\[(?:Test|TestCase|TestCaseSource|Fact|Theory|TestMethod|DataTestMethod|SkippableFact)\b/,
			/^\s*\[/,
			CHAR_SYNTAX,
		),
	},
	{
		files: /(_spec|_test)\.rb$|(^|\/)test_[^/]+\.rb$/,
		extract: combine(
			indented(/^\s*def\s+(test\w*)/, { endKeyword: true }),
			indented(/^\s*(?:it|specify|test|scenario)\s*\(?\s*['"]((?:\\.|[^'"\\])*)['"].*\bdo\b/, { endKeyword: true }),
		),
	},
	{
		files: /(^|\/)[^/]*Test\.php$|(^|\/)tests?\/.+\.php$/,
		extract: combine(
			annotated(/^\s*#\[Test\b/, /^\s*#\[/, PHP_SYNTAX),
			braced(/^[ \t]*(?:(?:public|protected|final)\s+)*function\s+(test\w*)\s*\(/, PHP_SYNTAX),
			calls("it|test", PHP_SYNTAX),
		),
	},
	{
		files: /(^|\/)[^/]*Tests?\.swift$|(^|\/)Tests\/.+\.swift$/,
		extract: combine(
			annotated(JVM_ANNOTATION, JVM_ATTRIBUTE, C_SYNTAX),
			braced(
				/^[ \t]*(?:(?:public|private|internal|open|override|static|final|async|@\w+)\s+)*func\s+(test\w*)\s*\(/,
				C_SYNTAX,
			),
		),
	},
	{
		files: /_test\.dart$/,
		extract: calls("test|testWidgets|testGoldens|blocTest", C_SYNTAX),
	},
	{
		files: /(_test|_tests|_unittest|Test|Tests|\.test)\.(c|cc|cpp|cxx|mm|m)$|(^|\/)test_[^/]+\.(c|cc|cpp|cxx)$|(^|\/)tests?\/.+\.(cc|cpp|cxx)$/,
		extract: combine(
			braced(
				/^[ \t]*(?:TEST|TEST_F|TEST_P|TYPED_TEST|TYPED_TEST_P|TEST_CASE|TEST_CASE_METHOD|SCENARIO|BOOST_AUTO_TEST_CASE|BOOST_FIXTURE_TEST_CASE)\s*\(\s*([^)\n]*)\)/,
				CHAR_SYNTAX,
			),
			braced(/^-\s*\(void\)\s*(test\w*)/, CHAR_SYNTAX),
		),
	},
	{
		files: /_test\.exs$/,
		extract: indented(/^\s*test\s+"((?:\\.|[^"\\])*)"/, {
			endKeyword: true,
		}),
	},
	{
		files: /_spec\.lua$|(^|\/)test_[^/]+\.lua$/,
		extract: calls("it|test|specify", {
			slashComments: false,
			hashComments: false,
			charQuote: false,
		}),
	},
	{
		files: /(^|\/)tests\/testthat\/test[-_][^/]+\.[rR]$/,
		extract: calls("test_that", HASH_SYNTAX),
	},
	{
		files: /\.bats$/,
		extract: braced(/^[ \t]*@test\s+(?:"((?:\\.|[^"\\])*)"|'([^']*)')\s*/, HASH_SYNTAX),
	},
	{
		files: /\.zig$/,
		extract: braced(/^[ \t]*test\s+(?:"((?:\\.|[^"\\])*)"|(\w+))\s*/, CHAR_SYNTAX),
	},
]

function languageOf(path: string): Language | undefined {
	return LANGUAGES.find((language) => language.files.test(path))
}

export function isTestFile(path: string): boolean {
	return !IGNORED_DIRECTORY.test(path) && languageOf(path) !== undefined
}

export function extractTestFunctions(file: string, text: string): RawTest[] {
	return languageOf(file)?.extract(file, text) ?? []
}

export function testQuestions(tests: readonly TestFunction[]): JevQuestions {
	return Object.fromEntries(
		tests.map((test) => [
			`keep_${test.id}`,
			{
				type: "noul" as const,
				instructions: `Unit test ${test.id} ("${test.name}" in ${test.file}) is worth keeping: it checks real behaviour that no other test covers`,
			},
		]),
	)
}

function testEntry(test: TestFunction, sourceChars: number): object {
	return {
		id: test.id,
		file: test.file,
		name: test.name,
		source: test.source.length > sourceChars ? `${test.source.slice(0, sourceChars)}…` : test.source,
	}
}

export function batchTests(tests: readonly TestFunction[], maxRequestTokens: number, sourceChars: number): TestFunction[][] {
	const base = estimateTokens(JSON.stringify({ context: TEST_STATE_CONTEXT, tests: [] }))
	const budget = maxRequestTokens - base
	const batches: TestFunction[][] = []
	let current: TestFunction[] = []
	let currentTokens = 0
	for (const test of tests) {
		const tokens =
			estimateTokens(JSON.stringify(testEntry(test, sourceChars))) + estimateTokens(JSON.stringify(testQuestions([test])))
		if (current.length > 0 && currentTokens + tokens > budget) {
			batches.push(current)
			current = []
			currentTokens = 0
		}
		current.push(test)
		currentTokens += tokens
	}
	if (current.length > 0) batches.push(current)
	return batches
}

export function removeRanges(text: string, ranges: ReadonlyArray<{ start: number; end: number }>): string {
	let result = text
	for (const { start, end } of [...ranges].sort((a, b) => b.start - a.start)) {
		const from = start
		let to = end
		if (result[to] === "\n") to += 1
		while (from > 0 && result[from - 1] === "\n" && result[to] === "\n") to += 1
		if (to >= result.length) {
			result = `${result.slice(0, from).replace(/\n+$/, "")}\n`
			continue
		}
		result = result.slice(0, from) + result.slice(to)
	}
	return result
}

export async function pruneTests(
	files: TestFileAccess,
	asker: JevAsker,
	options: {
		goal?: string
		deleteThreshold?: number
		maxRequestTokens?: number
		sourceChars?: number
	} = {},
): Promise<PruneTestsResult> {
	const threshold = options.deleteThreshold ?? DEFAULT_TEST_DELETE_THRESHOLD
	const maxRequestTokens = options.maxRequestTokens ?? DEFAULT_MAX_TEST_REQUEST_TOKENS
	const sourceChars = options.sourceChars ?? 2000
	const paths = (await files.list()).filter(isTestFile)
	const tests: TestFunction[] = []
	for (const path of paths) {
		const text = await files.read(path)
		for (const found of extractTestFunctions(path, text)) {
			tests.push({ id: `u${tests.length + 1}`, ...found })
		}
	}
	const scores: PruneTestsResult["scores"] = []
	const batches = batchTests(tests, maxRequestTokens, sourceChars)
	const answered = await Promise.all(
		batches.map(async (batch) => {
			const state = {
				context: TEST_STATE_CONTEXT,
				goal: options.goal ?? "",
				tests: batch.map((test) => testEntry(test, sourceChars)),
			}
			const { answers } = await asker.ask(state, testQuestions(batch))
			return batch.map((test) => ({
				test,
				keepTest: noulAnswer(answers, `keep_${test.id}`),
			}))
		}),
	)
	const deleted: TestDeletion[] = []
	for (const { test, keepTest } of answered.flat()) {
		scores.push({ id: test.id, file: test.file, name: test.name, keepTest })
		if (keepTest < threshold) {
			deleted.push({
				id: test.id,
				file: test.file,
				name: test.name,
				keepTest,
			})
		}
	}
	const doomed = new Set(deleted.map((entry) => entry.id))
	for (const path of new Set(deleted.map((entry) => entry.file))) {
		const ranges = tests.filter((test) => test.file === path && doomed.has(test.id))
		const text = await files.read(path)
		await files.write(path, removeRanges(text, ranges))
	}
	return {
		files: paths.length,
		tests: tests.length,
		requests: batches.length,
		deleted,
		scores,
	}
}
