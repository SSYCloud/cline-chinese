import { createHash } from "node:crypto"
import type { BatchArtifact, BatchLocalOutput } from "@shared/loomloom"
import type { BatchService } from "./batch-service"
import { classifyInlineText, MAX_INLINE_ARTIFACT_BYTES, saveInlineTextArtifact } from "./output-file-adapter"
import { isMediaArtifactCandidate, saveMediaArtifact } from "./output-media-adapter"

export const MAX_LOCAL_OUTPUT_FILES_PER_RUN = 1000
export const MAX_LOCAL_OUTPUT_BYTES_PER_RUN = 1024 * 1024 * 1024
export type BatchOutputWriter = typeof saveInlineTextArtifact
export type BatchMediaWriter = typeof saveMediaArtifact

/** Identity includes MIME because a changed declaration can change the generated file format. */
export function inlineArtifactContentHash(artifact: BatchArtifact): string {
	return createHash("sha256")
		.update(JSON.stringify([artifact.mimeType ?? "", artifact.portName ?? ""]))
		.update("\0")
		.update(artifact.inlineText ?? "")
		.digest("hex")
}

/** Hash an immutable run artifact identity without persisting a signed URL or treating query-token rotation as new content. */
export function mediaArtifactContentHash(artifact: BatchArtifact): string {
	let identity = artifact.artifactId
	if (!identity) {
		try {
			const url = new URL(artifact.accessUrl ?? "")
			identity = `${url.origin}${url.pathname}`
		} catch {
			identity = artifact.accessUrl ?? ""
		}
	}
	return createHash("sha256")
		.update(JSON.stringify(["media", artifact.mimeType ?? "", artifact.portName ?? "", identity]))
		.digest("hex")
}

function mediaFailure(error: unknown): string {
	const message = error instanceof Error ? error.message : ""
	// Only our own user-facing errors can be persisted: network errors may include signed URL parameters.
	if (/https?:|[?&][^\s]+=|(?:token|secret|signature|credential)=/i.test(message))
		return "图片或视频本地保存失败；请检查网络、地址有效期或保存目录后刷新结果重试。"
	if (message.startsWith("本批未绑定产物目录。")) return message
	if (
		/^(?:产物(?:下载地址无效|下载地址未解析到公网|内容不是受支持的图片或视频|声明类型与内容不一致|响应类型与内容不一致|响应编码不受支持|缺少可验证的媒体类型)|媒体产物(?:下载内容不完整|超过本地保存大小上限|下载超时)|图片或视频(?:产物下载失败|本地保存失败)|单个媒体产物超过|本批产物累计超过|仅支持无需额外鉴权的公网|批量产物(?:路径|目录|文件|根目录|临时文件|同名文件)|原任务未绑定输出目录)/.test(
			message,
		)
	)
		return message
	return "图片或视频本地保存失败；请检查网络、地址有效期或保存目录后刷新结果重试。"
}

/** Materializes only an explicitly refreshed/requested run; construction never sweeps history. */
export class BatchOutputCoordinator {
	private readonly pending = new Map<string, { again: boolean; force: boolean; promise: Promise<void> }>()
	private readonly unsubscribe: () => void
	private disposed = false
	constructor(
		private readonly service: BatchService,
		private readonly writer: BatchOutputWriter = saveInlineTextArtifact,
		private readonly mediaWriter: BatchMediaWriter = saveMediaArtifact,
	) {
		this.unsubscribe = service.subscribeResultsAvailable(({ taskId, runId }) => {
			// Writer failures are persisted separately. Storage failure must not reject the cloud refresh.
			void this.ensure(taskId, runId).catch(() => {})
		})
	}
	ensure(taskId: string, runId: string, force = false): Promise<void> {
		if (this.disposed) return Promise.resolve()
		const key = JSON.stringify([taskId, runId])
		const existing = this.pending.get(key)
		if (existing) {
			existing.again = true
			existing.force ||= force
			return existing.promise
		}
		const work = { again: true, force, promise: Promise.resolve() }
		this.pending.set(key, work)
		work.promise = (async () => {
			try {
				while (work.again && !this.disposed) {
					work.again = false
					const requestedForce = work.force
					work.force = false
					await this.materialize(taskId, runId, requestedForce)
				}
			} finally {
				this.pending.delete(key)
			}
		})()
		return work.promise
	}
	private async materialize(taskId: string, runId: string, force: boolean) {
		const session = await this.service.snapshot(taskId)
		if (!session || this.disposed) return
		const current = session.attempt?.runId === runId
		const past = current ? undefined : session.pastRuns?.find((run) => run.runId === runId)
		if (!current && !past) throw new Error("此运行不属于当前任务，不能保存产物。")
		// An attempt freezes even an absent destination. Never borrow a later task/workspace root.
		const destination = current ? session.attempt?.outputDestination : past?.outputDestination
		const rows = current ? session.results : past!.results
		const known = new Map(
			(session.localOutputs ?? [])
				.filter((file) => file.runId === runId)
				.map((file) => [`${file.rowIndex}:${file.artifactIndex}`, file]),
		)
		let fileCount = [...known.values()].filter((file) => file.status === "saved").length
		let totalBytes = [...known.values()].reduce((sum, file) => sum + (file.status === "saved" ? (file.sizeBytes ?? 0) : 0), 0)
		const records: BatchLocalOutput[] = []
		let candidates = 0
		for (const row of rows) {
			if (!Number.isSafeInteger(row.rowIndex) || row.rowIndex < 0) continue
			for (const [artifactIndex, artifact] of (row.artifacts ?? []).entries()) {
				if (this.disposed) break
				const isMedia = isMediaArtifactCandidate(artifact)
				const text = isMedia ? undefined : classifyInlineText(artifact)
				if (!isMedia && !text) continue
				const key = `${row.rowIndex}:${artifactIndex}`
				const previous = known.get(key)
				const contentHash = isMedia ? mediaArtifactContentHash(artifact) : inlineArtifactContentHash(artifact)
				if (!force && previous?.status === "saved" && previous.contentHash === contentHash) continue
				const record: BatchLocalOutput = {
					runId,
					rowIndex: row.rowIndex,
					artifactIndex,
					artifactId: artifact.artifactId,
					contentHash,
					status: "error",
				}
				try {
					if (
						++candidates > MAX_LOCAL_OUTPUT_FILES_PER_RUN ||
						(previous?.status !== "saved" && fileCount >= MAX_LOCAL_OUTPUT_FILES_PER_RUN)
					)
						throw new Error(
							`本批本地保存数量上限为 ${MAX_LOCAL_OUTPUT_FILES_PER_RUN} 个文件，剩余结果仍可在表格中查看。`,
						)
					if (!destination)
						throw new Error("本批未绑定产物目录。请在工作表中选择保存位置或另存本批；云端结果仍可查看。")
					const oldBytes = previous?.status === "saved" ? (previous.sizeBytes ?? 0) : 0
					const remaining = MAX_LOCAL_OUTPUT_BYTES_PER_RUN - totalBytes + oldBytes
					if (remaining <= 0) throw new Error("本批产物累计超过 1 GiB 本地保存上限，云端结果仍可查看。")
					const baseOptions = {
						baseDirectory: destination.baseDirectory,
						outputRootDirectory: destination.outputRootDirectory,
						taskId,
						runId,
						rowIndex: row.rowIndex,
						artifactIndex,
						artifact,
					}
					let saved: Awaited<ReturnType<BatchOutputWriter>>
					if (isMedia) saved = await this.mediaWriter({ ...baseOptions, maxBytes: remaining })
					else {
						if (!text || typeof artifact.inlineText !== "string") throw new Error("产物没有可保存的文本内容。")
						const sourceBytes = Buffer.byteLength(artifact.inlineText, "utf8")
						if (sourceBytes > MAX_INLINE_ARTIFACT_BYTES)
							throw new Error("文本产物超过本地保存大小上限，请从运行结果中另行处理。")
						const sizeBytes = Buffer.byteLength(text.content, "utf8")
						if (sizeBytes > remaining) throw new Error("本批产物累计超过 1 GiB 本地保存上限，云端结果仍可查看。")
						saved = await this.writer(baseOptions)
					}
					Object.assign(record, saved, { status: "saved" })
					fileCount += previous?.status === "saved" ? 0 : 1
					totalBytes += saved.sizeBytes - oldBytes
				} catch (error) {
					record.error = isMedia
						? mediaFailure(error)
						: error instanceof Error
							? error.message
							: "本地保存失败，请检查原任务目录权限后刷新结果重试。"
				}
				known.set(key, record)
				records.push(record)
				// One explicit overflow record reports the remaining files without unbounded error records.
				if (candidates > MAX_LOCAL_OUTPUT_FILES_PER_RUN) break
			}
			if (this.disposed || candidates > MAX_LOCAL_OUTPUT_FILES_PER_RUN) break
		}
		if (records.length) await this.service.recordLocalOutputs(taskId, runId, records, { outputDestination: destination })
	}
	async whenIdle(): Promise<void> {
		while (this.pending.size) await Promise.allSettled([...this.pending.values()].map((work) => work.promise))
	}
	dispose(): void {
		this.disposed = true
		this.unsubscribe()
	}
}
