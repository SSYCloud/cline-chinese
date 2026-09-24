import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { classifyInlineText, MAX_INLINE_ARTIFACT_BYTES, saveInlineTextArtifact } from "./output-file-adapter"

const temporaryDirectories: string[] = []

async function workspace(): Promise<string> {
	// Keep Windows fixtures on the workspace drive rather than the low-space system drive.
	const parent = process.platform === "win32" ? process.cwd() : os.tmpdir()
	const directory = await realpath(await mkdtemp(path.join(parent, ".loomloom-output-test-")))
	temporaryDirectories.push(directory)
	return directory
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) {
		if (!path.basename(directory).startsWith(".loomloom-output-test-")) throw new Error("Unexpected fixture path")
		await rm(directory, { recursive: true, force: true })
	}
})

function input(baseDirectory: string, inlineText = "你好，结果已生成。") {
	return { baseDirectory, taskId: "task-1", runId: "run-1", rowIndex: 0, artifactIndex: 0, artifact: { inlineText } }
}

describe("classifyInlineText", () => {
	it("ignores artifacts without nonblank text", () => {
		expect(classifyInlineText({})).toBeUndefined()
		for (const inlineText of ["", " \r\n\t", "\uFEFF\u3000"]) {
			expect(classifyInlineText({ inlineText })).toBeUndefined()
			expect(classifyInlineText({ inlineText, mimeType: "image/png" })).toBeUndefined()
		}
	})

	it.each([
		"image/png",
		"image/jpeg",
		" AUDIO/MPEG; charset=utf-8",
		"video/mp4",
		"font/woff2",
		"application/pdf",
		"application/zip",
		"application/gzip",
		"application/x-7z-compressed",
		"application/octet-stream",
		"application/x-executable",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/vnd.oasis.opendocument.text",
	])("does not materialize captions or text hints from binary MIME %s", (mimeType) => {
		expect(classifyInlineText({ inlineText: "a generated picture", mimeType })).toBeUndefined()
		expect(classifyInlineText({ inlineText: "<html>caption</html>", mimeType })).toBeUndefined()
	})

	it.each([
		[" TEXT/HTML; charset=utf-8", "html"],
		["application/xhtml+xml", "html"],
		["image/svg+xml", "svg"],
		["text/css", "css"],
		["application/javascript", "js"],
		["text/typescript", "ts"],
		["application/json", "json"],
		["text/markdown", "md"],
		["text/x-python", "py"],
		["text/x-yaml", "yaml"],
		["text/csv", "csv"],
	])("uses the allowlisted MIME %s", (mimeType, extension) => {
		const classified = classifyInlineText({ inlineText: " exact content\n", mimeType })
		expect(classified).toMatchObject({ content: " exact content\n", extension, detectedBy: "mime" })
	})

	it("keeps unknown MIME types and path-like port names as plain text", () => {
		const content = "hello\nworld\n"
		expect(
			classifyInlineText({ inlineText: content, mimeType: "application/x-custom-text", portName: "../../evil.exe" }),
		).toMatchObject({ content, extension: "txt", mimeType: "text/plain", detectedBy: "fallback" })
	})

	it("recognizes full HTML from generic text without dropping whitespace", () => {
		const content = '\n<!DOCTYPE html>\n<html lang="zh"><body>你好</body></html>\n'
		expect(classifyInlineText({ inlineText: content, mimeType: "text/plain" })).toEqual({
			content,
			extension: "html",
			mimeType: "text/html",
			detectedBy: "html-document",
		})
	})

	it.each([
		"<div>fragment</div>",
		"Here is HTML: <html>hello</html>",
		"<html>hello</html>\nExplanation",
	])("does not turn mixed content or fragments into an HTML document", (content) => {
		expect(classifyInlineText({ inlineText: content, mimeType: "text/plain" })).toMatchObject({ content, extension: "txt" })
	})

	it.each([
		["html", "html"],
		["svg", "svg"],
		["javascript", "js"],
		["typescript", "ts"],
		["python", "py"],
		["json", "json"],
		["markdown", "md"],
	])("unwraps a single whole-content %s fence", (language, extension) => {
		const content = `\`\`\`${language}\nexact source\n\`\`\``
		expect(classifyInlineText({ inlineText: content, mimeType: "text/plain" })).toMatchObject({
			content: "exact source",
			extension,
			detectedBy: "code-fence",
		})
	})

	it("handles CRLF and tilde fences", () => {
		expect(classifyInlineText({ inlineText: '~~~json\r\n{"ok":true}\r\n~~~\r\n' })).toMatchObject({
			content: '{"ok":true}',
			extension: "json",
		})
	})

	it.each([
		"Explanation\n```html\n<html>hello</html>\n```",
		"```html\n<html>hello</html>\n```\nExplanation",
		"```html\n<html>hello</html>\n```\n```html\n<html>other</html>\n```",
		"```unknown-language\nkeep every character\n```",
	])("does not discard prose, multiple blocks, or unknown fences", (content) => {
		expect(classifyInlineText({ inlineText: content })).toMatchObject({ content, extension: "txt" })
	})

	it("honors an explicit Markdown MIME over HTML and HTML fences", () => {
		for (const content of ["<html>hello</html>", "```html\n<html>hello</html>\n```", "Explanation\n```html\nx\n```"])
			expect(classifyInlineText({ inlineText: content, mimeType: "text/markdown" })).toMatchObject({
				content,
				extension: "md",
			})
	})

	it("unwraps a MIME-matching fence but preserves a conflicting fence", () => {
		expect(classifyInlineText({ inlineText: '```json\n{"ok":true}\n```', mimeType: "application/json" })).toMatchObject({
			content: '{"ok":true}',
			extension: "json",
		})
		const content = "```python\nprint(1)\n```"
		expect(classifyInlineText({ inlineText: content, mimeType: "application/json" })).toMatchObject({
			content,
			extension: "json",
		})
	})
})

describe("saveInlineTextArtifact", () => {
	it("saves UTF-8 bytes under task/run/row directories with hash metadata", async () => {
		const base = await workspace()
		const options = input(base)
		const saved = await saveInlineTextArtifact(options)
		expect(await readFile(saved.path, "utf8")).toBe(options.artifact.inlineText)
		expect(saved.sizeBytes).toBe(Buffer.byteLength(options.artifact.inlineText))
		expect(saved.sha256).toBe(createHash("sha256").update(options.artifact.inlineText).digest("hex"))
		expect(saved.relativePath.replaceAll(path.sep, "/")).toMatch(
			/^\.cline\/loomloom-outputs\/task-[a-f0-9]{20}\/run-[a-f0-9]{20}\/row-0001\/output-01-[a-f0-9]{20}\.txt$/,
		)
	})

	it("uses the detected type and hash of the normalized file content", async () => {
		const saved = await saveInlineTextArtifact(input(await workspace(), "```html\n<html>hello</html>\n```"))
		expect(saved.path).toEndWith(".html")
		expect(saved.mimeType).toBe("text/html")
		expect(await readFile(saved.path, "utf8")).toBe("<html>hello</html>")
		expect(saved.sha256).toBe(createHash("sha256").update("<html>hello</html>").digest("hex"))
	})

	it("saves SVG MIME as source text verbatim without evaluating it", async () => {
		const content = '\n<svg xmlns="http://www.w3.org/2000/svg"><script>throw new Error("never execute")</script></svg>\n'
		const saved = await saveInlineTextArtifact({
			...input(await workspace()),
			artifact: { inlineText: content, mimeType: " IMAGE/SVG+XML; charset=utf-8" },
		})
		expect(saved.extension).toBe("svg")
		expect(saved.path).toEndWith(".svg")
		expect(saved.mimeType).toBe("image/svg+xml")
		expect(await readFile(saved.path, "utf8")).toBe(content)
	})

	it("never uses remote IDs or port names as paths", async () => {
		const base = await workspace()
		const saved = await saveInlineTextArtifact({
			...input(base),
			taskId: "../../untrusted-task",
			runId: "C:\\Windows\\untrusted-run",
			artifact: { inlineText: "safe", artifactId: "../../escape", portName: "../remote.exe:stream" },
		})
		expect(path.relative(base, saved.path).startsWith(`.cline${path.sep}`)).toBe(true)
		expect(saved.relativePath).not.toContain("untrusted")
		expect(saved.relativePath).not.toContain("remote")
		expect(saved.relativePath).not.toContain("escape")
		expect(saved.extension).toBe("txt")
	})

	it("reuses the same file on repeated polls", async () => {
		const options = input(await workspace())
		const first = await saveInlineTextArtifact(options)
		expect(await saveInlineTextArtifact(options)).toEqual(first)
		expect(await readdir(path.dirname(first.path))).toEqual([path.basename(first.path)])
	})

	it("preserves user edits and reuses the next collision slot", async () => {
		const options = input(await workspace())
		const first = await saveInlineTextArtifact(options)
		await writeFile(first.path, "user's edited result")
		const second = await saveInlineTextArtifact(options)
		expect(second.path).not.toBe(first.path)
		expect(second.path).toEndWith("-2.txt")
		expect(await readFile(first.path, "utf8")).toBe("user's edited result")
		expect(await saveInlineTextArtifact(options)).toEqual(second)
	})

	it("publishes complete content once under concurrent saves", async () => {
		const options = input(await workspace(), "生成内容\n".repeat(10_000))
		const saved = await Promise.all(Array.from({ length: 12 }, () => saveInlineTextArtifact(options)))
		expect(new Set(saved.map((result) => result.path)).size).toBe(1)
		expect(await readFile(saved[0].path, "utf8")).toBe(options.artifact.inlineText)
		expect(await readdir(path.dirname(saved[0].path))).toEqual([path.basename(saved[0].path)])
	})

	it("keeps changed result content and other task/run/row/port slots separate", async () => {
		const options = input(await workspace())
		const variants = [
			options,
			{ ...options, artifact: { inlineText: "new version" } },
			{ ...options, taskId: "task-2" },
			{ ...options, runId: "run-2" },
			{ ...options, rowIndex: 1 },
			{ ...options, artifactIndex: 1 },
		]
		const saved = await Promise.all(variants.map(saveInlineTextArtifact))
		expect(new Set(saved.map((result) => result.path)).size).toBe(variants.length)
	})

	it("rejects a junction or directory symlink before creating any outside output", async () => {
		const base = await workspace()
		const outside = await workspace()
		await symlink(outside, path.join(base, ".cline"), process.platform === "win32" ? "junction" : "dir")
		await expect(saveInlineTextArtifact(input(base))).rejects.toThrow("符号链接")
		expect(await readdir(outside)).toEqual([])
	})

	it("rejects a nested directory junction even when it points inside the workspace", async () => {
		const base = await workspace()
		await mkdir(path.join(base, ".cline"))
		await mkdir(path.join(base, "internal-target"))
		await symlink(
			path.join(base, "internal-target"),
			path.join(base, ".cline", "loomloom-outputs"),
			process.platform === "win32" ? "junction" : "dir",
		)
		await expect(saveInlineTextArtifact(input(base))).rejects.toThrow("符号链接")
		expect(await readdir(path.join(base, "internal-target"))).toEqual([])
	})

	it("rejects a symbolic link at the exact output candidate", async () => {
		const options = input(await workspace())
		const first = await saveInlineTextArtifact(options)
		const outside = path.join(await workspace(), "outside.txt")
		await writeFile(outside, options.artifact.inlineText)
		await rm(first.path)
		await symlink(outside, first.path, "file")
		await expect(saveInlineTextArtifact(options)).rejects.toThrow("符号链接")
		expect(await readFile(outside, "utf8")).toBe(options.artifact.inlineText)
	})

	it("bounds collisions without overwriting files", async () => {
		const options = input(await workspace())
		const first = await saveInlineTextArtifact(options)
		await writeFile(first.path, "user edit")
		for (let index = 2; index <= 100; index++) await writeFile(first.path.replace(/\.txt$/, `-${index}.txt`), "user edit")
		await expect(saveInlineTextArtifact(options)).rejects.toThrow("同名文件过多")
		expect((await readdir(path.dirname(first.path))).length).toBe(100)
		expect(await readFile(first.path, "utf8")).toBe("user edit")
	})

	it("rejects oversize UTF-8 content before creating output directories", async () => {
		const base = await workspace()
		await expect(saveInlineTextArtifact(input(base, "字".repeat(Math.ceil(MAX_INLINE_ARTIFACT_BYTES / 3))))).rejects.toThrow(
			"10 MiB",
		)
		expect(await readdir(base)).toEqual([])
	})

	it("rejects an implicit workspace, missing text, or invalid indices", async () => {
		const options = input(await workspace())
		await expect(saveInlineTextArtifact({ ...options, baseDirectory: "." })).rejects.toThrow("工作目录")
		await expect(saveInlineTextArtifact({ ...options, artifact: {} })).rejects.toThrow("文本内容")
		await expect(saveInlineTextArtifact({ ...options, rowIndex: -1 })).rejects.toThrow("结果位置")
		await expect(saveInlineTextArtifact({ ...options, artifactIndex: Number.NaN })).rejects.toThrow("结果位置")
	})
})
