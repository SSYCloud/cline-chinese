import type { BatchField } from "./loomloom"
import { resolveBatchModelField } from "./loomloom-models"

export type BatchInputFileMode = "text" | "asset" | "reference"

/** Local product limits, independent of the remote service's upload limits. */
export const BATCH_TEXT_FILE_MAX_BYTES = 512 * 1024
export const BATCH_ASSET_FILE_MAX_BYTES = 20 * 1024 * 1024

/** Keep browser controls and the extension's file adapter on the same public-field rules. */
export function getBatchFileInputMode(field?: BatchField): BatchInputFileMode | undefined {
	if (!field) return "reference"
	if (field.value_type === "asset_ref") return "asset"
	if (resolveBatchModelField(field).isModel || field.enum_values?.length) return undefined
	if (field.value_type === "string") return "text"
	// text_reference and image_url have distinct public contracts; do not infer a conversion.
	return undefined
}

const FILE_MIME_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	bmp: "image/bmp",
	tif: "image/tiff",
	tiff: "image/tiff",
	avif: "image/avif",
	heic: "image/heic",
	heif: "image/heif",
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	mkv: "video/x-matroska",
	avi: "video/x-msvideo",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	flac: "audio/flac",
	ogg: "audio/ogg",
	oga: "audio/ogg",
	opus: "audio/ogg",
	m4a: "audio/mp4",
	aac: "audio/aac",
	pdf: "application/pdf",
	json: "application/json",
	jsonl: "application/x-ndjson",
	ndjson: "application/x-ndjson",
	xml: "application/xml",
	yaml: "application/yaml",
	yml: "application/yaml",
	md: "text/markdown",
	mdx: "text/markdown",
	csv: "text/csv",
	tsv: "text/tab-separated-values",
	html: "text/html",
	htm: "text/html",
	css: "text/css",
	js: "text/javascript",
	mjs: "text/javascript",
	cjs: "text/javascript",
	jsx: "text/javascript",
	ts: "text/plain",
	tsx: "text/plain",
	py: "text/x-python",
	sh: "text/x-shellscript",
	bash: "text/x-shellscript",
	zsh: "text/x-shellscript",
}

const PLAIN_TEXT_EXTENSIONS = new Set([
	"txt",
	"text",
	"rst",
	"log",
	"toml",
	"ini",
	"conf",
	"cfg",
	"env",
	"go",
	"rs",
	"java",
	"cs",
	"c",
	"cpp",
	"cc",
	"h",
	"hpp",
	"sql",
	"ps1",
	"bat",
	"cmd",
	"scss",
	"sass",
	"less",
	"vue",
	"svelte",
	"php",
	"rb",
	"kt",
	"kts",
	"swift",
	"lua",
	"r",
	"tex",
	"graphql",
	"gql",
	"proto",
])

/** Filename-only hint for display; asset imports must additionally inspect the bytes. */
export function getBatchFileMimeType(fileName: string): string {
	const name = fileName.split(/[\\/]/).pop()?.toLowerCase() ?? ""
	const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : ""
	if (Object.hasOwn(FILE_MIME_TYPES, extension)) return FILE_MIME_TYPES[extension]
	if (PLAIN_TEXT_EXTENSIONS.has(extension) || /^(?:dockerfile|makefile|readme|license|\.gitignore)$/i.test(name))
		return "text/plain"
	return "application/octet-stream"
}
