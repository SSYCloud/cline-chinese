import { createHash } from "node:crypto"
import type { BatchArtifact, BatchLocalOutput } from "@shared/loomloom"
import type { BatchService } from "./batch-service"
import { classifyInlineText, MAX_INLINE_ARTIFACT_BYTES, saveInlineTextArtifact } from "./output-file-adapter"

export const MAX_LOCAL_OUTPUT_FILES_PER_RUN = 1000
export const MAX_LOCAL_OUTPUT_BYTES_PER_RUN = 100 * 1024 * 1024
export type BatchOutputWriter = typeof saveInlineTextArtifact

/** Identity includes MIME because a changed declaration can change the generated file format. */
export function inlineArtifactContentHash(artifact: BatchArtifact): string {
	return createHash("sha256")
		.update(JSON.stringify([artifact.mimeType ?? "", artifact.portName ?? ""]))
		.update("\0")
		.update(artifact.inlineText ?? "")
		.digest("hex")
}

/** Materializes only an explicitly refreshed/requested run; construction never sweeps history. */
export class BatchOutputCoordinator {
	private readonly pending = new Map<string, { again: boolean; force: boolean; promise: Promise<void> }>()
	private readonly unsubscribe: () => void
	private disposed = false
	constructor(
		private readonly service: BatchService,
		private readonly writer: BatchOutputWriter = saveInlineTextArtifact,
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
				if (typeof artifact.inlineText !== "string") continue
				const key = `${row.rowIndex}:${artifactIndex}`
				const previous = known.get(key)
				const contentHash = inlineArtifactContentHash(artifact)
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
					const sourceBytes = Buffer.byteLength(artifact.inlineText, "utf8")
					if (sourceBytes > MAX_INLINE_ARTIFACT_BYTES) {
						candidates++
						throw new Error("文本产物超过本地保存大小上限，请从运行结果中另行处理。")
					}
					const classified = classifyInlineText(artifact)
					if (!classified) continue
					if (
						++candidates > MAX_LOCAL_OUTPUT_FILES_PER_RUN ||
						(previous?.status !== "saved" && fileCount >= MAX_LOCAL_OUTPUT_FILES_PER_RUN)
					)
						throw new Error(
							`本批本地保存数量上限为 ${MAX_LOCAL_OUTPUT_FILES_PER_RUN} 个文件，剩余结果仍可在表格中查看。`,
						)
					if (!destination)
						throw new Error(
							"原任务未绑定输出目录。请点击「保存文本产物」或「打开文件」补全原任务目录；云端结果仍可查看或复制。",
						)
					const sizeBytes = Buffer.byteLength(classified.content, "utf8")
					const oldBytes = previous?.status === "saved" ? (previous.sizeBytes ?? 0) : 0
					if (totalBytes - oldBytes + sizeBytes > MAX_LOCAL_OUTPUT_BYTES_PER_RUN)
						throw new Error("本批文本产物累计超过 100 MiB 本地保存上限，云端结果仍可查看。")
					const saved = await this.writer({
						baseDirectory: destination.baseDirectory,
						taskId,
						runId,
						rowIndex: row.rowIndex,
						artifactIndex,
						artifact,
					})
					Object.assign(record, saved, { status: "saved" })
					fileCount += previous?.status === "saved" ? 0 : 1
					totalBytes += saved.sizeBytes - oldBytes
				} catch (error) {
					record.error = error instanceof Error ? error.message : "本地保存失败，请检查原任务目录权限后刷新结果重试。"
				}
				known.set(key, record)
				records.push(record)
				// One explicit overflow record reports the remaining files without unbounded error records.
				if (candidates > MAX_LOCAL_OUTPUT_FILES_PER_RUN) break
			}
			if (this.disposed || candidates > MAX_LOCAL_OUTPUT_FILES_PER_RUN) break
		}
		if (records.length) await this.service.recordLocalOutputs(taskId, runId, records)
	}
	async whenIdle(): Promise<void> {
		while (this.pending.size) await Promise.allSettled([...this.pending.values()].map((work) => work.promise))
	}
	dispose(): void {
		this.disposed = true
		this.unsubscribe()
	}
}
