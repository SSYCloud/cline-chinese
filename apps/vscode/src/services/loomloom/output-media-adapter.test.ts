import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
	assertSafeMediaUrl,
	classifyMediaBytes,
	isMediaArtifactCandidate,
	isPublicMediaAddress,
	type MediaDownloadTransport,
	saveMediaArtifact,
} from "./output-media-adapter"

const directories: string[] = []
async function workspace() {
	const parent = process.platform === "win32" ? process.cwd() : os.tmpdir()
	const base = await realpath(await mkdtemp(path.join(parent, ".loomloom-media-test-")))
	directories.push(base)
	return base
}
afterEach(async () => {
	for (const directory of directories.splice(0)) {
		if (!path.basename(directory).startsWith(".loomloom-media-test-")) throw new Error("Unexpected test path")
		await rm(directory, { recursive: true, force: true })
	}
})

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("image bytes")])
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from("video bytes")])
const avif = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypavif"), Buffer.from("image bytes")])
const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from("\x00\x10webm video bytes")])
function transport(bytes: Buffer, mimeType: string): MediaDownloadTransport {
	return async (_url, file) => {
		await file.writeFile(bytes)
		return {
			mimeType,
			sizeBytes: bytes.length,
			sha256: createHash("sha256").update(bytes).digest("hex"),
			firstBytes: bytes,
		}
	}
}
function input(baseDirectory: string) {
	return {
		baseDirectory,
		taskId: "task-1",
		runId: "run-1",
		rowIndex: 0,
		artifactIndex: 0,
		artifact: { artifactId: "image-1", mimeType: "image/png", accessUrl: "https://cdn.example.com/asset.png?token=secret" },
	}
}

describe("media download boundary", () => {
	it.each([
		"127.0.0.1",
		"10.0.0.1",
		"169.254.169.254",
		"192.168.1.2",
		"100.64.0.1",
		"::1",
		"fc00::1",
		"::ffff:127.0.0.1",
		"2001:db8::1",
	])("blocks private/reserved address %s", (address) => expect(isPublicMediaAddress(address)).toBe(false))
	it.each(["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"])("permits public address %s", (address) =>
		expect(isPublicMediaAddress(address)).toBe(true))
	it.each([
		"http://cdn.example.com/a.png",
		"file:///C:/private.png",
		"https://127.0.0.1/a.png",
		"https://localhost/a.png",
		"https://user:password@cdn.example.com/a.png",
		"https://cdn.example.com:8443/a.png",
	])("rejects unsafe download URL %s", (url) => expect(() => assertSafeMediaUrl(url)).toThrow())
	it("never treats SVG, PDF, HTML, or arbitrary URLs as media candidates", () => {
		for (const mimeType of ["image/svg+xml", "application/pdf", "text/html"])
			expect(isMediaArtifactCandidate({ mimeType, accessUrl: "https://cdn.example.com/a.png" })).toBe(false)
		expect(isMediaArtifactCandidate({ accessUrl: "https://cdn.example.com/asset" })).toBe(false)
	})
	it("requires declared/response MIME and bytes to agree, never accepts active HTML", () => {
		expect(classifyMediaBytes({ mimeType: "image/png" }, "application/octet-stream", png)).toMatchObject({ extension: "png" })
		expect(classifyMediaBytes({ mimeType: "video/mp4" }, "video/mp4", mp4)).toMatchObject({ extension: "mp4" })
		expect(classifyMediaBytes({ mimeType: "image/avif" }, "image/avif", avif)).toMatchObject({ extension: "avif" })
		expect(classifyMediaBytes({ mimeType: "video/webm" }, "video/webm", webm)).toMatchObject({ extension: "webm" })
		expect(() => classifyMediaBytes({ mimeType: "image/png" }, "text/html", png)).toThrow("响应类型")
		expect(() => classifyMediaBytes({ mimeType: "image/png" }, "image/png", Buffer.from("<html>bad</html>"))).toThrow("内容")
		expect(() => classifyMediaBytes({ mimeType: "image/svg+xml" }, "image/svg+xml", Buffer.from("<svg></svg>"))).toThrow(
			"内容",
		)
	})
})

describe("saveMediaArtifact", () => {
	it("atomically saves an owned image in the workspace output folder without using cloud names as paths", async () => {
		const base = await workspace()
		const options = input(base)
		options.taskId = "../../remote-task"
		const saved = await saveMediaArtifact(options, transport(png, "image/png"))
		expect(await readFile(saved.path)).toEqual(png)
		expect(saved.sha256).toBe(createHash("sha256").update(png).digest("hex"))
		expect(saved.relativePath.replaceAll(path.sep, "/")).toMatch(
			/^\.cline\/loomloom-outputs\/task-[a-f0-9]{20}\/run-[a-f0-9]{20}\/row-0001\/output-01-[a-f0-9]{20}\.png$/,
		)
		expect(saved.path).not.toContain("remote-task")
	})
	it("supports an exact custom output root and video files", async () => {
		const base = await workspace()
		const selectedRoot = await workspace()
		const saved = await saveMediaArtifact(
			{
				...input(base),
				outputRootDirectory: selectedRoot,
				artifact: { accessUrl: "https://cdn.example.com/clip.mp4", mimeType: "video/mp4" },
			},
			transport(mp4, "video/mp4"),
		)
		expect(saved.path.startsWith(selectedRoot + path.sep)).toBe(true)
		expect(saved.relativePath.replaceAll(path.sep, "/")).toMatch(/^task-[a-f0-9]{20}\/run-[a-f0-9]{20}\/row-0001\//)
		expect(saved.extension).toBe("mp4")
		expect(await readFile(saved.path)).toEqual(mp4)
	})
	it("reuses an unchanged media file and preserves user edits with a collision suffix", async () => {
		const options = input(await workspace())
		const first = await saveMediaArtifact(options, transport(png, "image/png"))
		expect(await saveMediaArtifact(options, transport(png, "image/png"))).toEqual(first)
		await writeFile(first.path, "user edit")
		const next = await saveMediaArtifact(options, transport(png, "image/png"))
		expect(next.path).not.toBe(first.path)
		expect(next.path).toEndWith("-2.png")
		expect(await readFile(first.path, "utf8")).toBe("user edit")
	})
	it("rejects invalid payload and leaves no temporary file", async () => {
		const options = input(await workspace())
		await expect(saveMediaArtifact(options, transport(Buffer.from("<script>bad</script>"), "image/png"))).rejects.toThrow(
			"内容",
		)
		const names = await readdir(options.baseDirectory, { recursive: true })
		expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([])
	})
	it("does not follow a selected-root symlink or create files outside it", async () => {
		const base = await workspace()
		const parent = await workspace()
		const outside = await workspace()
		const selectedRoot = path.join(parent, "linked")
		await symlink(outside, selectedRoot, process.platform === "win32" ? "junction" : "dir")
		await expect(
			saveMediaArtifact({ ...input(base), outputRootDirectory: selectedRoot }, transport(png, "image/png")),
		).rejects.toThrow("符号链接")
		expect(await readdir(outside)).toEqual([])
	})
	it("enforces the caller's remaining per-run allowance before publishing", async () => {
		const options = { ...input(await workspace()), maxBytes: png.length - 1 }
		await expect(saveMediaArtifact(options, transport(png, "image/png"))).rejects.toThrow("大小上限")
		const names = await readdir(options.baseDirectory, { recursive: true })
		expect(names.filter((name) => name.endsWith(".png"))).toEqual([])
	})
})
