import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rmdir, symlink, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import type { BatchField } from "@shared/loomloom"
import {
	BATCH_ASSET_FILE_MAX_BYTES,
	BATCH_TEXT_FILE_MAX_BYTES,
	getBatchFileInputMode,
	getBatchFileMimeType,
} from "@shared/loomloom-files"
import { readBatchInputFile } from "./input-file-adapter"

let directory: string
const fixtures = new Set<string>()
const folders = new Set<string>()
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/n5sAAAAASUVORK5CYII=", "base64")

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "cline-loomloom-input-"))
})

afterAll(async () => {
	// Only individual fixtures within this test's new temporary directory are removed.
	if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("cline-loomloom-input-"))
		throw new Error("Unexpected fixture directory")
	for (const path of fixtures) {
		if (dirname(resolve(path)) !== resolve(directory)) throw new Error("Unexpected fixture path")
		await unlink(path)
	}
	for (const path of folders) await rmdir(path)
	await rmdir(directory)
})

async function fixture(name: string, contents: string | Buffer): Promise<string> {
	const path = join(directory, name)
	await writeFile(path, contents)
	fixtures.add(path)
	return path
}

function isoMedia(brand: string): Buffer {
	const bytes = Buffer.alloc(24)
	bytes.writeUInt32BE(24, 0)
	bytes.write("ftyp", 4)
	bytes.write(brand, 8)
	bytes.write(brand, 16)
	bytes.write("isom", 20)
	return bytes
}

describe("Batch file input fields", () => {
	it("accepts plain string fields and assets, with metadata-only references when no field is selected", () => {
		expect(getBatchFileInputMode()).toBe("reference")
		expect(getBatchFileInputMode({ key: "prompt", value_type: "string" })).toBe("text")
		expect(getBatchFileInputMode({ key: "prompt", value_type: "string", enum_values: [] })).toBe("text")
		expect(getBatchFileInputMode({ key: "picture", value_type: "asset_ref" })).toBe("asset")
		expect(getBatchFileInputMode({ key: "model_reference", value_type: "asset_ref" })).toBe("asset")
	})

	for (const field of [
		{ key: "text_model", value_type: "string" },
		{ key: "choice", value_type: "string", enum_values: ["a", "b"] },
		{ key: "choice", value_type: "enum" },
		{ key: "custom", label: "图像模型", value_type: "string" },
		{ key: "custom", value_type: "string", model_override: { step_type: "text-generate" } },
		{ key: "source", value_type: "text_reference" },
		{ key: "picture", value_type: "image_url" },
		{ key: "count", value_type: "integer" },
		{ key: "enabled", value_type: "boolean" },
	] satisfies BatchField[]) {
		it(`does not offer automatic import for ${field.key}/${field.value_type}`, () => {
			expect(getBatchFileInputMode(field)).toBeUndefined()
		})
	}

	it("provides case-insensitive MIME hints without browser-unsafe imports", () => {
		expect(getBatchFileMimeType("C:\\demo\\PHOTO.JPEG")).toBe("image/jpeg")
		expect(getBatchFileMimeType("README.md")).toBe("text/markdown")
		expect(getBatchFileMimeType("main.py")).toBe("text/x-python")
		expect(getBatchFileMimeType("Dockerfile")).toBe("text/plain")
		expect(getBatchFileMimeType("opaque.bin")).toBe("application/octet-stream")
	})
})

describe("bounded Batch local file adapter", () => {
	it("preserves Unicode, whitespace and CRLF exactly and never writes to the original", async () => {
		const text = "// 中文 👋\r\nexport const answer = 42\r\n  \t\r\n"
		const path = await fixture("source.ts", text)
		const result = await readBatchInputFile(path, "text")
		expect(result).toEqual({
			path,
			name: "source.ts",
			mimeType: "text/plain",
			sizeBytes: Buffer.byteLength(text),
			sha256: createHash("sha256").update(text).digest("hex"),
			text,
		})
		expect(await readFile(path, "utf8")).toBe(text)
	})

	it("supports source files with no extension, unknown text extensions and empty text", async () => {
		for (const [name, contents] of [
			["Dockerfile", "FROM alpine\n"],
			["script.custom", "print('hello')\n"],
			["empty.txt", ""],
		]) {
			const path = await fixture(name, contents)
			expect(await readBatchInputFile(path, "text")).toMatchObject({ name, text: contents, mimeType: "text/plain" })
		}
	})

	it("decodes UTF-8, UTF-16LE and UTF-16BE BOMs while hashing the original bytes", async () => {
		const text = "中文 and emoji 😀\r\n"
		const encoded = Buffer.from(text, "utf16le")
		for (const [name, contents] of [
			["utf8.txt", Buffer.concat([Buffer.from([239, 187, 191]), Buffer.from(text)])],
			["utf16le.txt", Buffer.concat([Buffer.from([255, 254]), encoded])],
			["utf16be.txt", Buffer.concat([Buffer.from([254, 255]), Buffer.from(encoded).swap16()])],
		] as const) {
			const result = await readBatchInputFile(await fixture(name, contents), "text")
			expect(result.text).toBe(text)
			expect(result.sizeBytes).toBe(contents.length)
			expect(result.sha256).toBe(createHash("sha256").update(contents).digest("hex"))
		}
	})

	it("rejects malformed encodings and binary controls rather than producing mojibake", async () => {
		for (const [name, bytes] of [
			["invalid-utf8.txt", Buffer.from([0xc3, 0x28])],
			["truncated-utf16.txt", Buffer.from([0xff, 0xfe, 0x61])],
			["invalid-surrogate.txt", Buffer.from([0xff, 0xfe, 0x00, 0xd8])],
			["binary.txt", Buffer.from([0x61, 0x00, 0x62])],
			["utf32.txt", Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x61, 0x00, 0x00, 0x00])],
		] as const)
			await expect(readBatchInputFile(await fixture(name, bytes), "text")).rejects.toThrow()
	})

	it("keeps SVG source exact in text mode and preserves SVG upload behavior in asset mode", async () => {
		const text =
			'<?xml version="1.0"?>\r\n<svg xmlns="http://www.w3.org/2000/svg">\r\n  <text>中文</text><script>throw new Error("inert source")</script>\r\n</svg>\r\n'
		const path = await fixture("source.svg", text)
		const imported = await readBatchInputFile(path, "text")
		expect(imported.text).toBe(text)
		expect(imported.base64).toBeUndefined()
		expect(imported.sha256).toBe(createHash("sha256").update(text).digest("hex"))
		expect(await readFile(path, "utf8")).toBe(text)
		const asset = await readBatchInputFile(path, "asset")
		expect(asset.mimeType).toBe("image/svg+xml")
		expect(asset.text).toBeUndefined()
		expect(Buffer.from(asset.base64 ?? "", "base64").toString("utf8")).toBe(text)
	})

	it("rejects PDF/raster media in text mode even when renamed or composed of valid UTF-8", async () => {
		for (const [name, contents] of [
			["renamed.txt", "%PDF-1.7\nASCII content"],
			["image.png", png],
			["raster-disguised.svg", png],
			["document.docx", "not really a document"],
		] as const)
			await expect(readBatchInputFile(await fixture(name, contents), "text")).rejects.toThrow("不能作为正文")
	})

	it("rejects known secret files and private-key contents with an actionable message", async () => {
		for (const name of [".env", ".env.local", "ID_ED25519", "id_ecdsa_sk", "private.pem", "private.key", "store.p12"]) {
			const path = await fixture(name, "example secret")
			await expect(readBatchInputFile(path, "text")).rejects.toThrow("脱敏副本")
			const reference = await readBatchInputFile(path, "reference")
			expect(reference.text).toBeUndefined()
			expect(reference.base64).toBeUndefined()
			expect(reference.sha256).toBeUndefined()
		}
		await expect(
			readBatchInputFile(await fixture("disguised.txt", "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret"), "text"),
		).rejects.toThrow("私钥")
	})

	it("enforces byte limits with no silent truncation while reference mode reads no contents", async () => {
		const textPath = await fixture("text-limit.txt", Buffer.alloc(BATCH_TEXT_FILE_MAX_BYTES, 97))
		expect((await readBatchInputFile(textPath, "text")).text?.length).toBe(BATCH_TEXT_FILE_MAX_BYTES)
		await writeFile(textPath, Buffer.alloc(BATCH_TEXT_FILE_MAX_BYTES + 1, 97))
		await expect(readBatchInputFile(textPath, "text")).rejects.toThrow("512 KiB")
		const bigPath = await fixture("asset-limit.png", Buffer.alloc(BATCH_ASSET_FILE_MAX_BYTES + 1))
		await expect(readBatchInputFile(bigPath, "asset")).rejects.toThrow("20 MiB")
		expect(await readBatchInputFile(bigPath, "reference")).toEqual({
			path: bigPath,
			name: "asset-limit.png",
			mimeType: "image/png",
			sizeBytes: BATCH_ASSET_FILE_MAX_BYTES + 1,
		})
	})

	it("detects image, video, audio and PDF MIME types from bytes and preserves the asset bytes", async () => {
		const wave = Buffer.alloc(44)
		wave.write("RIFF", 0)
		wave.writeUInt32LE(36, 4)
		wave.write("WAVE", 8)
		wave.write("fmt ", 12)
		for (const [name, contents, mimeType] of [
			["actual.PNG", png, "image/png"],
			["actual.gif", Buffer.from("GIF89a\u0001\u0000\u0001\u0000"), "image/gif"],
			["actual.pdf", Buffer.from("%PDF-1.7\n%%EOF\n"), "application/pdf"],
			["actual.wav", wave, "audio/wav"],
			["actual.mp3", Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, 0, 0]), "audio/mpeg"],
			["actual.mp4", isoMedia("isom"), "video/mp4"],
			["actual.m4a", isoMedia("M4A "), "audio/mp4"],
			["actual.avif", isoMedia("avif"), "image/avif"],
		] as const) {
			const path = await fixture(name, contents)
			const result = await readBatchInputFile(path, "asset")
			expect(result.mimeType).toBe(mimeType)
			expect(result.text).toBeUndefined()
			expect(Buffer.from(result.base64 ?? "", "base64")).toEqual(Buffer.from(contents))
			expect(result.sha256).toBe(createHash("sha256").update(contents).digest("hex"))
			expect(await readFile(path)).toEqual(contents)
		}
	})

	it("refuses extension-only media, truncated headers, text assets and format mismatches", async () => {
		for (const [name, contents] of [
			["fake.png", Buffer.from("plain text")],
			["short.png", png.subarray(0, 8)],
			["wrong.jpg", png],
			["plain.txt", Buffer.from("hello")],
		] as const)
			await expect(readBatchInputFile(await fixture(name, contents), "asset")).rejects.toThrow()
	})

	it("rejects directories and missing files", async () => {
		const path = join(directory, "child-directory")
		await mkdir(path)
		folders.add(path)
		await expect(readBatchInputFile(path, "reference")).rejects.toThrow("普通文件")
		await expect(readBatchInputFile(join(directory, "missing.txt"), "text")).rejects.toThrow()
	})

	it("rejects symbolic links even when they point at an ordinary file", async () => {
		const target = await fixture("link-target.txt", "ordinary text")
		const path = join(directory, "linked.txt")
		await symlink(target, path, "file")
		fixtures.add(path)
		await expect(readBatchInputFile(path, "text")).rejects.toThrow("符号链接")
	})

	it("refuses network paths before trying to read a file", async () => {
		for (const path of ["https://example.invalid/file.txt", "\\\\server\\share\\file.txt", "//server/share/file.txt"])
			await expect(readBatchInputFile(path, "text")).rejects.toThrow("本机")
	})
})
