import { createHash, randomUUID } from "node:crypto"
import { constants, type Stats } from "node:fs"
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises"
import path from "node:path"
import type { BatchArtifact } from "../../shared/loomloom"

export const MAX_INLINE_ARTIFACT_BYTES = 10 * 1024 * 1024
const MAX_COLLISIONS = 100

const BINARY_MIMES = new Set([
	"application/octet-stream",
	"application/pdf",
	"application/zip",
	"application/x-zip-compressed",
	"application/gzip",
	"application/x-gzip",
	"application/x-tar",
	"application/x-bzip",
	"application/x-bzip2",
	"application/x-7z-compressed",
	"application/vnd.rar",
	"application/x-rar-compressed",
	"application/zstd",
	"application/x-executable",
	"application/x-msdownload",
	"application/wasm",
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
])

const FORMATS: Record<string, { extension: string; mimeType: string }> = {
	html: { extension: "html", mimeType: "text/html" },
	svg: { extension: "svg", mimeType: "image/svg+xml" },
	css: { extension: "css", mimeType: "text/css" },
	js: { extension: "js", mimeType: "text/javascript" },
	jsx: { extension: "jsx", mimeType: "text/jsx" },
	ts: { extension: "ts", mimeType: "text/typescript" },
	tsx: { extension: "tsx", mimeType: "text/tsx" },
	json: { extension: "json", mimeType: "application/json" },
	json5: { extension: "json5", mimeType: "application/json5" },
	md: { extension: "md", mimeType: "text/markdown" },
	py: { extension: "py", mimeType: "text/x-python" },
	xml: { extension: "xml", mimeType: "application/xml" },
	yaml: { extension: "yaml", mimeType: "application/yaml" },
	csv: { extension: "csv", mimeType: "text/csv" },
	tsv: { extension: "tsv", mimeType: "text/tab-separated-values" },
	sql: { extension: "sql", mimeType: "application/sql" },
	txt: { extension: "txt", mimeType: "text/plain" },
}

const MIME_FORMATS = new Map([
	...Object.entries(FORMATS).map(([format, { mimeType }]) => [mimeType, format] as const),
	["application/xhtml+xml", "html"],
	["application/javascript", "js"],
	["application/x-javascript", "js"],
	["application/typescript", "ts"],
	["application/ld+json", "json"],
	["text/x-markdown", "md"],
	["application/x-python-code", "py"],
	["text/xml", "xml"],
	["text/yaml", "yaml"],
	["text/x-yaml", "yaml"],
	["application/x-yaml", "yaml"],
])

const LANGUAGE_FORMATS = new Map([
	...Object.keys(FORMATS).map((format) => [format, format] as const),
	["htm", "html"],
	["xhtml", "html"],
	["javascript", "js"],
	["typescript", "ts"],
	["markdown", "md"],
	["python", "py"],
	["yml", "yaml"],
	["text", "txt"],
	["plaintext", "txt"],
])

/** Only unwrap one complete, recognized fenced block; prose or multiple blocks are kept verbatim. */
function singleCodeFence(content: string): { content: string; format: string } | undefined {
	const match = /^(`{3,}|~{3,})([\w#+.-]+)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*$/.exec(content.trim())
	if (!match) return undefined
	const format = LANGUAGE_FORMATS.get(match[2].toLowerCase())
	if (!format) return undefined
	const hasEarlierClosingFence = match[3].split(/\r?\n/).some((line) => {
		const closing = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)
		return closing && closing[1][0] === match[1][0] && closing[1].length >= match[1].length
	})
	return hasEarlierClosingFence ? undefined : { content: match[3], format }
}

function isHtmlDocument(content: string): boolean {
	return /^(?:<!doctype\s+html[^>]*>\s*)?<html(?:\s[^>]*)?>[\s\S]*<\/html\s*>$/i.test(content.trim())
}

export function classifyInlineText(
	artifact: Pick<BatchArtifact, "inlineText" | "mimeType" | "portName">,
): { content: string; extension: string; mimeType: string; detectedBy: string } | undefined {
	if (typeof artifact.inlineText !== "string" || !artifact.inlineText.trim()) return undefined
	const content = artifact.inlineText
	const mime = typeof artifact.mimeType === "string" ? artifact.mimeType.split(";", 1)[0].trim().toLowerCase() : ""
	// A binary artifact may carry a caption or an empty text field alongside its real download URL.
	if (
		(/^(?:image|audio|video|font)\//.test(mime) && mime !== "image/svg+xml") ||
		mime.startsWith("application/vnd.openxmlformats-officedocument.") ||
		mime.startsWith("application/vnd.oasis.opendocument.") ||
		BINARY_MIMES.has(mime)
	) {
		return undefined
	}
	const mimeFormat = MIME_FORMATS.get(mime)
	const fence = singleCodeFence(content)
	if (mimeFormat && mimeFormat !== "txt") {
		// A Markdown document containing one fenced block is still a Markdown document.
		const unwrap = fence?.format === mimeFormat
		return { content: unwrap ? fence.content : content, ...FORMATS[mimeFormat], detectedBy: "mime" }
	}
	if (fence) return { content: fence.content, ...FORMATS[fence.format], detectedBy: "code-fence" }
	if (isHtmlDocument(content)) return { content, ...FORMATS.html, detectedBy: "html-document" }
	return { content, ...FORMATS.txt, detectedBy: mimeFormat ? "mime" : "fallback" }
}

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex")
}

function hasCode(error: unknown, code: string): boolean {
	return typeof error === "object" && error !== null && "code" in error && error.code === code
}

function assertContained(base: string, target: string): void {
	const relative = path.relative(base, target)
	if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		throw new Error("批量产物路径超出任务工作目录。")
	}
}

/** Never follow a symlink/junction in an output directory, even when it points within the workspace. */
async function checkDirectories(base: string, segments: string[], create: boolean): Promise<string> {
	let current = base
	for (const segment of segments) {
		current = path.join(current, segment)
		assertContained(base, current)
		if (create) {
			try {
				await mkdir(current)
			} catch (error) {
				if (!hasCode(error, "EEXIST")) throw error
			}
		}
		const info = await lstat(current)
		if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("批量产物目录不能是符号链接、目录联接或普通文件。")
		const canonical = await realpath(current)
		assertContained(base, canonical)
		if (path.relative(current, canonical) !== "") throw new Error("批量产物目录的实际路径发生变化。")
	}
	return current
}

function sameFile(left: Stats, right: Stats): boolean {
	return left.dev === right.dev && left.ino === right.ino
}

async function sameExistingContent(base: string, candidate: string, bytes: Buffer): Promise<boolean | undefined> {
	let info: Stats
	try {
		info = await lstat(candidate)
	} catch (error) {
		if (hasCode(error, "ENOENT")) return undefined
		throw error
	}
	if (info.isSymbolicLink()) throw new Error("批量产物文件不能是符号链接。")
	if (!info.isFile() || info.size !== bytes.length) return false
	assertContained(base, await realpath(candidate))
	const file = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
	try {
		const opened = await file.stat()
		if (!opened.isFile() || !sameFile(info, opened)) throw new Error("批量产物文件在读取时发生变化。")
		// Bounded reads also protect against another process growing a preexisting file.
		const existing = Buffer.alloc(bytes.length + 1)
		let read = 0
		while (read < existing.length) {
			const result = await file.read(existing, read, existing.length - read, read)
			if (!result.bytesRead) break
			read += result.bytesRead
		}
		const after = await lstat(candidate)
		if (after.isSymbolicLink() || !sameFile(opened, after)) throw new Error("批量产物文件在读取时发生变化。")
		return read === bytes.length && existing.subarray(0, read).equals(bytes)
	} finally {
		await file.close()
	}
}

export async function saveInlineTextArtifact(options: {
	baseDirectory: string
	taskId: string
	runId: string
	/** Zero-based row and artifact indices. */
	rowIndex: number
	artifactIndex: number
	artifact: BatchArtifact
}): Promise<{ path: string; relativePath: string; sha256: string; sizeBytes: number; extension: string; mimeType: string }> {
	const { baseDirectory, taskId, runId, rowIndex, artifactIndex, artifact } = options
	if (!path.isAbsolute(baseDirectory)) throw new Error("批量产物需要明确的任务工作目录。")
	if (
		!Number.isSafeInteger(rowIndex) ||
		rowIndex < 0 ||
		!Number.isSafeInteger(artifactIndex) ||
		artifactIndex < 0 ||
		!taskId ||
		!runId
	) {
		throw new Error("批量产物缺少有效的任务、运行或结果位置。")
	}
	if (typeof artifact.inlineText === "string" && Buffer.byteLength(artifact.inlineText, "utf8") > MAX_INLINE_ARTIFACT_BYTES) {
		throw new Error("单个文本产物超过 10 MiB，未自动保存。")
	}
	const classified = classifyInlineText(artifact)
	if (!classified) throw new Error("产物没有可保存的文本内容。")
	const bytes = Buffer.from(classified.content, "utf8")
	const digest = sha256(bytes)
	const base = await realpath(baseDirectory)
	if (!(await lstat(base)).isDirectory()) throw new Error("任务工作目录不存在。")
	const segments = [
		".cline",
		"loomloom-outputs",
		`task-${sha256(taskId).slice(0, 20)}`,
		`run-${sha256(runId).slice(0, 20)}`,
		`row-${String(rowIndex + 1).padStart(4, "0")}`,
	]
	const directory = await checkDirectories(base, segments, true)
	const stem = `output-${String(artifactIndex + 1).padStart(2, "0")}-${digest.slice(0, 20)}`
	let temporary: { path: string; info: Stats } | undefined
	try {
		for (let collision = 0; collision < MAX_COLLISIONS; collision++) {
			await checkDirectories(base, segments, false)
			const suffix = collision ? `-${collision + 1}` : ""
			const candidate = path.join(directory, `${stem}${suffix}.${classified.extension}`)
			const existing = await sameExistingContent(base, candidate, bytes)
			if (existing === false) continue
			if (existing === undefined) {
				if (!temporary) {
					const temporaryPath = path.join(directory, `.${stem}-${randomUUID()}.tmp`)
					const file = await open(temporaryPath, "wx", 0o600)
					temporary = { path: temporaryPath, info: await file.stat() }
					try {
						await file.writeFile(bytes)
					} finally {
						await file.close()
					}
				}
				await checkDirectories(base, segments, false)
				// link() publishes a complete file atomically and refuses an existing destination.
				try {
					await link(temporary.path, candidate)
				} catch (error) {
					if (!hasCode(error, "EEXIST")) throw error
					if (!(await sameExistingContent(base, candidate, bytes))) continue
				}
			}
			await checkDirectories(base, segments, false)
			if (!(await sameExistingContent(base, candidate, bytes))) continue
			return {
				path: candidate,
				relativePath: path.relative(base, candidate),
				sha256: digest,
				sizeBytes: bytes.length,
				extension: classified.extension,
				mimeType: classified.mimeType,
			}
		}
		throw new Error("批量产物同名文件过多，未覆盖任何现有文件。")
	} finally {
		if (temporary) {
			// Only remove the exact temporary file we created, with its parents still intact.
			await checkDirectories(base, segments, false)
			const info = await lstat(temporary.path)
			if (!info.isSymbolicLink() && sameFile(info, temporary.info)) await unlink(temporary.path)
		}
	}
}
