import { createHash, randomUUID } from "node:crypto"
import { lookup } from "node:dns/promises"
import { constants, type Stats } from "node:fs"
import { type FileHandle, link, lstat, open, unlink } from "node:fs/promises"
import { request as httpsRequest } from "node:https"
import { BlockList, isIP } from "node:net"
import path from "node:path"
import type { BatchArtifact } from "../../shared/loomloom"
import { assertContained, checkDirectories, outputDirectory } from "./output-file-adapter"

export const MAX_MEDIA_ARTIFACT_BYTES = 256 * 1024 * 1024
const MAX_COLLISIONS = 100
const DOWNLOAD_TIMEOUT_MS = 60_000
const MIME_EXTENSIONS = new Map([
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/webp", "webp"],
	["image/gif", "gif"],
	["image/avif", "avif"],
	["video/mp4", "mp4"],
	["video/webm", "webm"],
])
const EXTENSION_MIMES = new Map([
	...Array.from(MIME_EXTENSIONS, ([mime, extension]) => [extension, mime] as const),
	["jpeg", "image/jpeg"],
])

const blockedV4 = new BlockList()
for (const [subnet, bits] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const)
	blockedV4.addSubnet(subnet, bits, "ipv4")
const allowedV6 = new BlockList()
allowedV6.addSubnet("2000::", 3, "ipv6")
const blockedV6 = new BlockList()
for (const [subnet, bits] of [
	["2001::", 32], // Teredo can tunnel an internal IPv4 address.
	["2001:10::", 28],
	["2001:db8::", 32],
	["2002::", 16], // 6to4 can tunnel an internal IPv4 address.
	["3fff::", 20],
] as const)
	blockedV6.addSubnet(subnet, bits, "ipv6")

export function isPublicMediaAddress(address: string): boolean {
	const normalized = address.replace(/^\[/, "").replace(/\]$/, "")
	const family = isIP(normalized)
	if (family === 4) return !blockedV4.check(normalized, "ipv4")
	if (family === 6) return allowedV6.check(normalized, "ipv6") && !blockedV6.check(normalized, "ipv6")
	return false
}

/** Signed URLs are untrusted cloud data. Never let their hostname become a local or internal service request. */
export function assertSafeMediaUrl(value: string): URL {
	if (value.length > 8192) throw new Error("产物下载地址无效，云端结果仍可查看。")
	let url: URL
	try {
		url = new URL(value)
	} catch {
		throw new Error("产物下载地址无效，云端结果仍可查看。")
	}
	if (
		url.protocol !== "https:" ||
		!url.hostname ||
		url.username ||
		url.password ||
		(url.port && url.port !== "443") ||
		url.hostname.endsWith(".local") ||
		url.hostname.endsWith(".localhost") ||
		url.hostname === "localhost" ||
		(isIP(url.hostname.replace(/^\[/, "").replace(/\]$/, "")) > 0 && !isPublicMediaAddress(url.hostname))
	)
		throw new Error("仅支持无需额外鉴权的公网 HTTPS 图片或视频产物，云端结果仍可查看。")
	return url
}

function normalizeMime(value: string | undefined): string {
	return value?.split(";", 1)[0].trim().toLowerCase() ?? ""
}

/** We only fetch media candidates, never arbitrary PDF, HTML, SVG or executables. */
export function isMediaArtifactCandidate(artifact: BatchArtifact): boolean {
	if (typeof artifact.accessUrl !== "string" || !artifact.accessUrl) return false
	const declared = normalizeMime(artifact.mimeType)
	if (declared && declared !== "application/octet-stream") return MIME_EXTENSIONS.has(declared)
	try {
		return EXTENSION_MIMES.has(new URL(artifact.accessUrl).pathname.split(".").at(-1)?.toLowerCase() ?? "")
	} catch {
		return false
	}
}

function detectMagic(firstBytes: Buffer): string | undefined {
	if (firstBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png"
	if (firstBytes.length >= 3 && firstBytes[0] === 0xff && firstBytes[1] === 0xd8 && firstBytes[2] === 0xff) return "image/jpeg"
	if (["GIF87a", "GIF89a"].includes(firstBytes.toString("ascii", 0, 6))) return "image/gif"
	if (firstBytes.toString("ascii", 0, 4) === "RIFF" && firstBytes.toString("ascii", 8, 12) === "WEBP") return "image/webp"
	if (firstBytes.toString("ascii", 4, 8) === "ftyp") {
		const brands = firstBytes.toString("ascii", 8, Math.min(firstBytes.length, 64))
		return /(?:^|.{4})(?:avif|avis)/.test(brands) ? "image/avif" : "video/mp4"
	}
	if (
		firstBytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) &&
		firstBytes.toString("ascii", 0, Math.min(firstBytes.length, 256)).includes("webm")
	)
		return "video/webm"
	return undefined
}

export function classifyMediaBytes(artifact: BatchArtifact, responseMime: string | undefined, firstBytes: Buffer) {
	const detected = detectMagic(firstBytes)
	if (!detected) throw new Error("产物内容不是受支持的图片或视频，未保存到本地。")
	const declared = normalizeMime(artifact.mimeType)
	const response = normalizeMime(responseMime)
	if (declared && declared !== "application/octet-stream" && declared !== detected)
		throw new Error("产物声明类型与内容不一致，未保存到本地。")
	if (response && response !== "application/octet-stream" && response !== detected)
		throw new Error("产物响应类型与内容不一致，未保存到本地。")
	if (!declared && !response) throw new Error("产物缺少可验证的媒体类型，未保存到本地。")
	const extension = MIME_EXTENSIONS.get(detected)
	if (!extension) throw new Error("产物内容不是受支持的图片或视频，未保存到本地。")
	return { mimeType: detected, extension }
}

export interface MediaDownloadResult {
	mimeType?: string
	sizeBytes: number
	sha256: string
	firstBytes: Buffer
}
export type MediaDownloadTransport = (url: URL, output: FileHandle, maxBytes: number) => Promise<MediaDownloadResult>

/** TLS hostname verification stays enabled; DNS is resolved once, checked, then pinned for the socket. */
export const downloadPublicHttpsMedia: MediaDownloadTransport = async (url, output, maxBytes) => {
	const hostname = url.hostname.replace(/^\[/, "").replace(/\]$/, "")
	const addresses = isIP(hostname)
		? [{ address: hostname, family: isIP(hostname) as 4 | 6 }]
		: await lookup(hostname, { all: true, verbatim: true })
	if (!addresses.length || addresses.some(({ address }) => !isPublicMediaAddress(address)))
		throw new Error("产物下载地址未解析到公网，云端结果仍可查看。")
	const pinned = addresses[0]
	return new Promise<MediaDownloadResult>((resolve, reject) => {
		const req = httpsRequest(
			url,
			{
				method: "GET",
				agent: false,
				lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
				headers: { Accept: "image/*, video/*, application/octet-stream", "Accept-Encoding": "identity" },
			},
			async (response) => {
				try {
					if (response.statusCode !== 200) throw new Error("图片或视频产物下载失败，云端结果仍可查看。")
					const responseMime = Array.isArray(response.headers["content-type"])
						? response.headers["content-type"][0]
						: response.headers["content-type"]
					const declaredMime = normalizeMime(responseMime)
					if (declaredMime && declaredMime !== "application/octet-stream" && !MIME_EXTENSIONS.has(declaredMime))
						throw new Error("产物响应类型与内容不一致，未保存到本地。")
					const encoding = response.headers["content-encoding"]
					if (encoding && encoding !== "identity") throw new Error("产物响应编码不受支持，云端结果仍可查看。")
					const declaredLength = Number(response.headers["content-length"])
					if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
						throw new Error("单个媒体产物超过 256 MiB，未自动保存。")
					const hash = createHash("sha256")
					const first: Buffer[] = []
					let sizeBytes = 0
					let headerBytes = 0
					for await (const chunk of response) {
						const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
						sizeBytes += bytes.length
						if (sizeBytes > maxBytes) throw new Error("单个媒体产物超过 256 MiB，未自动保存。")
						if (headerBytes < 256) {
							const sample = bytes.subarray(0, 256 - headerBytes)
							first.push(Buffer.from(sample))
							headerBytes += sample.length
						}
						hash.update(bytes)
						await output.writeFile(bytes)
					}
					resolve({
						mimeType: responseMime,
						sizeBytes,
						sha256: hash.digest("hex"),
						firstBytes: Buffer.concat(first),
					})
				} catch (error) {
					response.destroy()
					reject(error)
				}
			},
		)
		const timer = setTimeout(() => req.destroy(new Error("媒体产物下载超时，云端结果仍可查看。")), DOWNLOAD_TIMEOUT_MS)
		req.on("error", reject)
		req.on("close", () => clearTimeout(timer))
		req.end()
	})
}

function sameFile(left: Stats, right: Stats): boolean {
	return left.dev === right.dev && left.ino === right.ino
}

async function sameExistingMedia(
	base: string,
	candidate: string,
	expectedSize: number,
	expectedDigest: string,
): Promise<boolean | undefined> {
	let info: Stats
	try {
		info = await lstat(candidate)
	} catch (error) {
		if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return undefined
		throw error
	}
	if (info.isSymbolicLink()) throw new Error("批量产物文件不能是符号链接。")
	if (!info.isFile() || info.size !== expectedSize) return false
	assertContained(base, candidate)
	const file = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
	try {
		const opened = await file.stat()
		if (!opened.isFile() || !sameFile(info, opened)) throw new Error("批量产物文件在读取时发生变化。")
		const hash = createHash("sha256")
		let read = 0
		const buffer = Buffer.allocUnsafe(64 * 1024)
		while (read < expectedSize + 1) {
			const chunk = await file.read(buffer, 0, Math.min(buffer.length, expectedSize + 1 - read), read)
			if (!chunk.bytesRead) break
			read += chunk.bytesRead
			hash.update(buffer.subarray(0, chunk.bytesRead))
		}
		const after = await lstat(candidate)
		if (after.isSymbolicLink() || !sameFile(opened, after)) throw new Error("批量产物文件在读取时发生变化。")
		return read === expectedSize && hash.digest("hex") === expectedDigest
	} finally {
		await file.close()
	}
}

export async function saveMediaArtifact(
	options: {
		baseDirectory: string
		outputRootDirectory?: string
		taskId: string
		runId: string
		rowIndex: number
		artifactIndex: number
		artifact: BatchArtifact
		/** Remaining per-run allowance, enforced while streaming. */
		maxBytes?: number
	},
	transport: MediaDownloadTransport = downloadPublicHttpsMedia,
): Promise<{ path: string; relativePath: string; sha256: string; sizeBytes: number; extension: string; mimeType: string }> {
	const { baseDirectory, outputRootDirectory, taskId, runId, rowIndex, artifactIndex, artifact, maxBytes } = options
	if (!Number.isSafeInteger(artifactIndex) || artifactIndex < 0) throw new Error("批量产物缺少有效的任务、运行或结果位置。")
	if (!isMediaArtifactCandidate(artifact)) throw new Error("产物不是可自动保存的图片或视频。")
	const downloadCap = Math.min(MAX_MEDIA_ARTIFACT_BYTES, maxBytes ?? MAX_MEDIA_ARTIFACT_BYTES)
	if (!Number.isSafeInteger(downloadCap) || downloadCap < 1) throw new Error("本批产物累计超过本地保存上限，云端结果仍可查看。")
	const url = assertSafeMediaUrl(artifact.accessUrl ?? "")
	const { base, segments, directory } = await outputDirectory({ baseDirectory, outputRootDirectory, taskId, runId, rowIndex })
	const temporaryPath = path.join(directory, `.media-${randomUUID()}.tmp`)
	const file = await open(temporaryPath, "wx", 0o600)
	const temporaryInfo = await file.stat()
	try {
		const downloaded = await transport(url, file, downloadCap)
		if (downloaded.sizeBytes > downloadCap) throw new Error("媒体产物超过本地保存大小上限，云端结果仍可查看。")
		const info = await file.stat()
		if (!info.isFile() || !sameFile(info, temporaryInfo) || info.size !== downloaded.sizeBytes)
			throw new Error("媒体产物下载内容不完整，云端结果仍可查看。")
		const { extension, mimeType } = classifyMediaBytes(artifact, downloaded.mimeType, downloaded.firstBytes)
		await file.close()
		const stem = `output-${String(artifactIndex + 1).padStart(2, "0")}-${downloaded.sha256.slice(0, 20)}`
		for (let collision = 0; collision < MAX_COLLISIONS; collision++) {
			await checkDirectories(base, segments, false)
			const suffix = collision ? `-${collision + 1}` : ""
			const candidate = path.join(directory, `${stem}${suffix}.${extension}`)
			const existing = await sameExistingMedia(base, candidate, downloaded.sizeBytes, downloaded.sha256)
			if (existing === false) continue
			if (existing === undefined) {
				const temporaryNow = await lstat(temporaryPath)
				if (temporaryNow.isSymbolicLink() || !sameFile(temporaryNow, temporaryInfo))
					throw new Error("批量产物临时文件在保存时发生变化。")
				try {
					await link(temporaryPath, candidate)
				} catch (error) {
					if (typeof error !== "object" || !error || !("code" in error) || error.code !== "EEXIST") throw error
					if (!(await sameExistingMedia(base, candidate, downloaded.sizeBytes, downloaded.sha256))) continue
				}
			}
			await checkDirectories(base, segments, false)
			if (!(await sameExistingMedia(base, candidate, downloaded.sizeBytes, downloaded.sha256))) continue
			return {
				path: candidate,
				relativePath: path.relative(base, candidate),
				sha256: downloaded.sha256,
				sizeBytes: downloaded.sizeBytes,
				extension,
				mimeType,
			}
		}
		throw new Error("批量产物同名文件过多，未覆盖任何现有文件。")
	} finally {
		await file.close().catch(() => {})
		await checkDirectories(base, segments, false)
		const info = await lstat(temporaryPath)
		if (!info.isSymbolicLink() && sameFile(info, temporaryInfo)) await unlink(temporaryPath)
	}
}
