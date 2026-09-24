import { createHash } from "node:crypto"
import { constants, type Stats } from "node:fs"
import { lstat, open } from "node:fs/promises"
import { basename, extname, resolve } from "node:path"
import {
	BATCH_ASSET_FILE_MAX_BYTES,
	BATCH_TEXT_FILE_MAX_BYTES,
	type BatchInputFileMode,
	getBatchFileMimeType,
} from "@shared/loomloom-files"

export interface BatchInputFileData {
	path: string
	name: string
	mimeType: string
	sizeBytes: number
	/** Present only when text or asset mode has read the bounded file contents. */
	sha256?: string
	text?: string
	base64?: string
}

function sameFile(first: Stats, second: Stats): boolean {
	return (
		first.dev === second.dev &&
		first.ino === second.ino &&
		first.size === second.size &&
		first.mtimeMs === second.mtimeMs &&
		first.ctimeMs === second.ctimeMs
	)
}

function requireRegularFile(stat: Stats): void {
	if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("请选择普通文件；不支持目录或符号链接。")
}

function isSensitiveName(name: string): boolean {
	return (
		/^\.env(?:\.|$)/i.test(name) ||
		/^id_(?:rsa|dsa|ecdsa|ed25519)(?:_sk)?$/i.test(name) ||
		/\.(?:pem|key|p12|pfx|jks|keystore)$/i.test(name)
	)
}

function sensitiveFileError(): Error {
	return new Error("此文件可能包含环境密钥或私钥，不能自动导入正文。请先创建脱敏副本，或仅添加为本地参考附件。")
}

function isAssetMime(mime: string): boolean {
	return /^(?:image|video|audio)\//.test(mime) || mime === "application/pdf"
}

function isOpaqueFileName(name: string): boolean {
	return /\.(?:zip|gz|tgz|bz2|xz|7z|rar|exe|dll|so|dylib|bin|wasm|class|pyc|db|sqlite3?|docx?|xlsx?|pptx?|rtf)$/i.test(name)
}

function startsWithBytes(bytes: Buffer, signature: number[]): boolean {
	return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value)
}

function asciiAt(bytes: Buffer, offset: number, value: string): boolean {
	return bytes.length >= offset + value.length && bytes.toString("ascii", offset, offset + value.length) === value
}

/** Header checks catch mislabeled/non-media input; this is not a full media decoder. */
function detectAssetMime(bytes: Buffer, name: string): string | undefined {
	if (bytes.length >= 24 && startsWithBytes(bytes, [137, 80, 78, 71, 13, 10, 26, 10]) && asciiAt(bytes, 12, "IHDR"))
		return "image/png"
	if (bytes.length >= 4 && startsWithBytes(bytes, [255, 216, 255])) return "image/jpeg"
	if (bytes.length >= 10 && (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a"))) return "image/gif"
	if (bytes.length >= 16 && asciiAt(bytes, 0, "RIFF")) {
		if (asciiAt(bytes, 8, "WEBP")) return "image/webp"
		if (asciiAt(bytes, 8, "WAVE")) return "audio/wav"
		if (asciiAt(bytes, 8, "AVI ")) return "video/x-msvideo"
	}
	if (bytes.length >= 26 && asciiAt(bytes, 0, "BM")) return "image/bmp"
	if (bytes.length >= 8 && (startsWithBytes(bytes, [73, 73, 42, 0]) || startsWithBytes(bytes, [77, 77, 0, 42])))
		return "image/tiff"
	if (bytes.length >= 8 && asciiAt(bytes, 0, "%PDF-") && /^\d\.\d/.test(bytes.toString("ascii", 5, 8))) return "application/pdf"
	if (bytes.length >= 8 && asciiAt(bytes, 0, "fLaC")) return "audio/flac"
	if (bytes.length >= 27 && asciiAt(bytes, 0, "OggS") && bytes[4] === 0) return "audio/ogg"
	if (
		(bytes.length >= 10 && asciiAt(bytes, 0, "ID3") && bytes[3] >= 2 && bytes[3] <= 4) ||
		(bytes.length >= 4 &&
			bytes[0] === 255 &&
			(bytes[1] & 224) === 224 &&
			(bytes[1] & 6) !== 0 &&
			(bytes[2] & 240) !== 0 &&
			(bytes[2] & 240) !== 240 &&
			(bytes[2] & 12) !== 12)
	)
		return "audio/mpeg"
	if (bytes.length >= 7 && bytes[0] === 255 && (bytes[1] & 246) === 240) return "audio/aac"
	if (bytes.length >= 16 && asciiAt(bytes, 4, "ftyp")) {
		const boxSize = bytes.readUInt32BE(0)
		if (boxSize < 16 || boxSize > bytes.length) return undefined
		const brands = [bytes.toString("ascii", 8, 12)]
		for (let offset = 16; offset + 4 <= Math.min(boxSize, 256); offset += 4)
			brands.push(bytes.toString("ascii", offset, offset + 4))
		if (brands.some((brand) => ["avif", "avis"].includes(brand))) return "image/avif"
		if (brands.some((brand) => ["heic", "heix", "hevc", "hevx"].includes(brand))) return "image/heic"
		if (brands.some((brand) => ["mif1", "msf1"].includes(brand))) return "image/heif"
		if (brands.includes("qt  ")) return "video/quicktime"
		if (brands.some((brand) => ["M4A ", "M4B "].includes(brand)) || extname(name).toLowerCase() === ".m4a") return "audio/mp4"
		if (brands.some((brand) => /^(?:isom|iso[2-9]|mp4[12]|M4V |avc1|dash|MSNV)$/.test(brand))) return "video/mp4"
	}
	if (startsWithBytes(bytes, [26, 69, 223, 163])) {
		const header = bytes.subarray(0, 4096)
		if (header.includes(Buffer.from("webm"))) return "video/webm"
		if (header.includes(Buffer.from("matroska"))) return "video/x-matroska"
	}
	const xmlHeader = bytes
		.subarray(0, 4096)
		.toString("utf8")
		.replace(/^\uFEFF/, "")
	if (/^(?:\s*<\?xml[\s\S]*?\?>)?(?:\s*<!--[\s\S]*?-->)*\s*<svg(?:\s|>)/i.test(xmlHeader)) return "image/svg+xml"
	return undefined
}

function decodeText(bytes: Buffer): string {
	let encoding = "utf-8"
	let payload = bytes
	if (startsWithBytes(bytes, [255, 254])) {
		encoding = "utf-16le"
		payload = bytes.subarray(2)
	} else if (startsWithBytes(bytes, [254, 255])) {
		encoding = "utf-16be"
		payload = bytes.subarray(2)
	} else if (startsWithBytes(bytes, [239, 187, 191])) payload = bytes.subarray(3)
	let text: string
	try {
		// fatal prevents invalid bytes from becoming replacement characters in submitted text.
		text = new TextDecoder(encoding, { fatal: true, ignoreBOM: true }).decode(payload)
	} catch {
		throw new Error("文件不是有效的 UTF-8 或带 BOM 的 UTF-16 文本。请转换编码后重新选择；不会截断或替换字符。")
	}
	// biome-ignore lint/suspicious/noControlCharactersInRegex: Detect binary/control bytes instead of submitting them as text.
	if (/[\u0000-\u0008\u000b\u000e-\u001f\u007f-\u009f]/u.test(text))
		throw new Error("文件含有二进制或不可打印字符，不能作为正文导入。请选择代码或纯文本文件。")
	if (/-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|PuTTY-User-Key-File-\d+:/i.test(text)) throw sensitiveFileError()
	return text
}

/** Read selected local input only. No upload, execution, truncation or original-file modification. */
export async function readBatchInputFile(sourcePath: string, mode: BatchInputFileMode): Promise<BatchInputFileData> {
	if (!sourcePath || /^(?:[\\/]{2}|[a-z]+:\/\/)/i.test(sourcePath)) throw new Error("请选择本机上的普通文件。")
	if (!["text", "asset", "reference"].includes(mode)) throw new Error("不支持此文件导入方式。")
	const path = resolve(sourcePath)
	const name = basename(path)
	const hintedMime = getBatchFileMimeType(name)
	if (mode === "text" && isSensitiveName(name)) throw sensitiveFileError()
	const initial = await lstat(path)
	requireRegularFile(initial)
	// O_NOFOLLOW closes the final-component symlink race where supported. The handle and
	// path are rechecked as well for platforms where this flag is unavailable.
	const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
	try {
		const before = await handle.stat()
		requireRegularFile(before)
		if (!sameFile(initial, before)) throw new Error("文件在读取前发生变化，请重新选择。")
		const result: BatchInputFileData = { path, name, mimeType: hintedMime, sizeBytes: before.size }
		let bytes: Buffer | undefined
		if (mode !== "reference") {
			const limit = mode === "text" ? BATCH_TEXT_FILE_MAX_BYTES : BATCH_ASSET_FILE_MAX_BYTES
			if (before.size > limit)
				throw new Error(
					`文件超出本地${mode === "text" ? "正文导入上限 512 KiB" : "附件读取上限 20 MiB"}；请选择较小文件或拆分后重试。`,
				)
			// At most limit + 1 bytes are ever read, including the growth probe. A stable
			// descriptor is used throughout instead of reopening the path for readFile.
			const buffer = Buffer.alloc(before.size + 1)
			let count = 0
			while (count < buffer.length) {
				const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count)
				if (!bytesRead) break
				count += bytesRead
			}
			if (count !== before.size) throw new Error("文件在读取过程中发生变化，请重新选择。")
			bytes = buffer.subarray(0, count)
		}
		const after = await handle.stat()
		const currentPath = await lstat(path)
		requireRegularFile(currentPath)
		if (!sameFile(before, after) || !sameFile(before, currentPath)) throw new Error("文件在读取过程中发生变化，请重新选择。")
		if (!bytes) return result
		result.sha256 = createHash("sha256").update(bytes).digest("hex")
		const detectedMime = detectAssetMime(bytes, name)
		if (mode === "text") {
			// SVG is also editable XML source; explicit text imports keep it inert and exact.
			if (
				(detectedMime && detectedMime !== "image/svg+xml") ||
				(isAssetMime(hintedMime) && hintedMime !== "image/svg+xml") ||
				isOpaqueFileName(name)
			)
				throw new Error("媒体、PDF 和二进制文件不能作为正文导入。请选择代码或纯文本文件，或将媒体添加到附件字段。")
			result.text = decodeText(bytes)
			if (result.mimeType === "application/octet-stream") result.mimeType = "text/plain"
		} else {
			if (!detectedMime) throw new Error("无法识别附件格式或文件头无效。请选择有效的图片、音频、视频或 PDF 文件。")
			if (isAssetMime(hintedMime) && hintedMime !== detectedMime)
				throw new Error("文件扩展名与实际附件格式不一致，请检查文件后重新选择。")
			result.mimeType = detectedMime
			result.base64 = bytes.toString("base64")
		}
		return result
	} finally {
		await handle.close()
	}
}
