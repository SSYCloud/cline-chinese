import type { BatchArtifact, BatchResultRow, BatchTaskStatus, BatchValue, SkillBot } from "@shared/loomloom"
import { parseBatchSchema } from "@shared/loomloom"
import { BATCH_MODEL_STEP_TYPES } from "@shared/loomloom-models"
import { fetch } from "@/shared/net"
import { LoomLoomRequestNotSubmittedError } from "./errors"

const BASE = "https://loomloom.shengsuanyun.com/loom/v1"
type ObjectValue = Record<string, any>
export interface BatchApi {
	models?(stepType: string): Promise<{ id: string; name: string }[]>
	detail(id: string): Promise<SkillBot>
	quote(id: string, versionId: string, rows: Record<string, BatchValue>[]): Promise<ObjectValue>
	execute(id: string, versionId: string, rows: Record<string, BatchValue>[], requestId: string): Promise<ObjectValue>
	run(id: string): Promise<{
		status: string
		total: number
		completed: number
		failed: number
		cancelled?: number
		startedAt?: number
		completedAt?: number
		updatedAt?: number
		tasks?: BatchTaskStatus[]
		rows: BatchResultRow[]
		artifacts: BatchArtifact[]
		listingId?: string
	}>
}

function skillBot(item: ObjectValue, includeSchema = false): SkillBot {
	if (typeof item.id !== "string") throw new Error("市场返回了无效的 SkillBot。")
	return {
		id: item.id,
		name: String(item.displayName || item.id),
		description: String(item.description || ""),
		versionId: String(item.listingVersionId || ""),
		availability: String(item.executionAvailabilityStatus || "unknown"),
		fee: item.taskFixedFee,
		...(includeSchema ? { schema: parseBatchSchema(item.inputSchemaSnapshot) } : {}),
	}
}

/** Cloud payloads can never supply trusted host metadata such as local paths or save status. */
function publicResultRow(value: unknown): BatchResultRow {
	if (!value || typeof value !== "object") throw new Error("运行结果行格式无效。")
	const row = value as ObjectValue
	if (!Number.isSafeInteger(row.rowIndex) || row.rowIndex < 0 || typeof row.status !== "string")
		throw new Error("运行结果行位置或状态无效。")
	return {
		rowIndex: row.rowIndex,
		status: row.status,
		errorMessage: typeof row.errorMessage === "string" ? row.errorMessage : undefined,
		stepErrors: Array.isArray(row.stepErrors)
			? row.stepErrors
					.filter((error: unknown) => error && typeof error === "object")
					.map((error: ObjectValue) => ({
						stepId: typeof error.stepId === "string" ? error.stepId : undefined,
						errorMessage: typeof error.errorMessage === "string" ? error.errorMessage : undefined,
					}))
			: undefined,
		artifacts: Array.isArray(row.artifacts)
			? row.artifacts
					.filter((artifact: unknown) => artifact && typeof artifact === "object")
					.map(
						(artifact: ObjectValue): BatchArtifact => ({
							artifactId: typeof artifact.artifactId === "string" ? artifact.artifactId : undefined,
							sourceRowIndex: row.rowIndex,
							inlineText: typeof artifact.inlineText === "string" ? artifact.inlineText : undefined,
							accessUrl: typeof artifact.accessUrl === "string" ? artifact.accessUrl : undefined,
							portName: typeof artifact.portName === "string" ? artifact.portName : undefined,
							mimeType: typeof artifact.mimeType === "string" ? artifact.mimeType : undefined,
						}),
					)
			: undefined,
	}
}

/** Only the extension holds credentials. All requests use the existing proxy-aware transport. */
export class LoomLoomClient implements BatchApi {
	constructor(
		private readonly key: () => string | undefined,
		private readonly transport: typeof fetch = fetch,
	) {}
	private async request(route: string, body?: unknown, publicRead = false): Promise<ObjectValue> {
		const key = this.key()
		if (!key && !publicRead) throw new LoomLoomRequestNotSubmittedError("请先登录胜算云或配置已有的胜算云 API Key。")
		const response = await this.transport(`${BASE}${route}`, {
			method: body === undefined ? "GET" : "POST",
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				...(key ? { Authorization: `Bearer ${key}` } : {}),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		})
		if (!response.ok) {
			if (response.status === 401 || response.status === 403)
				throw new Error("胜算云凭据未被接受，请重新登录或检查现有 API Key。草稿已保留。")
			let detail = ""
			try {
				const error: unknown = await response.json()
				if (error && typeof error === "object" && "error" in error && typeof error.error === "string")
					detail = error.error.slice(0, 300)
			} catch {
				// The status code remains useful when the service returns a non-JSON error.
			}
			if (key) detail = detail.replaceAll(key, "[redacted]")
			detail = detail.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
			throw new Error(`LoomLoom 请求失败（HTTP ${response.status}）${detail ? `：${detail}` : "。请检查输入或稍后重试。"}`)
		}
		return (await response.json()) as ObjectValue
	}
	// Creator endpoints use the same ShengSuanYun credential and proxy-aware transport.
	// Each write is a single request; ambiguous failures must be inspected, never auto-retried.
	creatorContext() {
		return this.request("/templateAuthoringContext")
	}
	creatorResolveCapabilities(inputModalities: string[], outputModality: string, modelId?: string) {
		const query = new URLSearchParams({ outputModality })
		for (const modality of inputModalities) query.append("inputModality", modality)
		if (modelId) query.set("modelId", modelId)
		return this.request(`/authoringCapabilities:resolve?${query}`)
	}
	creatorTemplates(pageOffset = 0) {
		return this.request(`/users/me/templates?${new URLSearchParams({ pageSize: "100", pageOffset: String(pageOffset) })}`)
	}
	creatorVersions(templateId: string) {
		return this.request(`/users/me/templates/${encodeURIComponent(templateId)}/versions`)
	}
	creatorVersionSpec(templateId: string, versionId: string) {
		return this.request(`/users/me/templates/${encodeURIComponent(templateId)}/versions/${encodeURIComponent(versionId)}`)
	}
	creatorValidate(canonicalSpecV2: Record<string, unknown>) {
		return this.request("/templateSpecs:validate", { specVersion: "template-spec/v2", canonicalSpecV2 })
	}
	creatorCreateTemplate(name: string, description: string) {
		return this.request("/users/me/templates", { name, description })
	}
	creatorSaveVersion(templateId: string, canonicalSpecV2: Record<string, unknown>, versionNote: string) {
		return this.request(`/users/me/templates/${encodeURIComponent(templateId)}/versions`, {
			specVersion: "template-spec/v2",
			canonicalSpecV2,
			versionNote,
		})
	}
	creatorPublish(input: {
		templateId: string
		templateVersionId: string
		displayName: string
		description: string
		taskFixedFee: { amount: string; currency: string }
		listingId?: string
	}) {
		return this.request("/marketListings", input)
	}
	creatorReview(reviewRequestId: string) {
		return this.request(`/creators/me/marketReviewRequests/${encodeURIComponent(reviewRequestId)}`)
	}
	creatorReviews() {
		return this.request("/creators/me/marketReviewRequests")
	}
	creatorListings() {
		return this.request("/creators/me/marketListings")
	}
	creatorEarnings() {
		return this.request("/creators/me/earnings")
	}
	creatorRunStatus(runId: string) {
		return this.request(`/users/me/runs/${encodeURIComponent(runId)}`)
	}
	creatorUploadInput(filename: string, content: string) {
		return this.request("/orchestrationInputs:upload", { filename, content })
	}
	creatorPrecheck(templateId: string, versionId: string, inputFileId: string) {
		return this.request(`/users/me/templates/${encodeURIComponent(templateId)}:precheck`, { versionId, inputFileId })
	}
	creatorRun(
		templateId: string,
		input: {
			versionId: string
			inputFileId: string
			clientRequestId: string
			expectedEstimatedCostT: number
			expectedPricingRevision: string
		},
	) {
		return this.request(`/users/me/templates/${encodeURIComponent(templateId)}:run`, input)
	}
	async catalog(keyword = "", pageToken = ""): Promise<{ items: SkillBot[]; nextPageToken: string }> {
		const data = await this.request(
			`/marketListings?${new URLSearchParams({ keyword, pageToken, pageSize: "20" })}`,
			undefined,
			true,
		)
		return {
			items: (data.items ?? []).map((item: ObjectValue) => skillBot(item)),
			nextPageToken: String(data.nextPageToken || ""),
		}
	}
	async detail(id: string) {
		return skillBot(await this.request(`/marketListings/${encodeURIComponent(id)}`, undefined, true), true)
	}
	quote(id: string, versionId: string, inputRows: Record<string, BatchValue>[]) {
		return this.request(`/marketListings/${encodeURIComponent(id)}:quote`, { listingVersionId: versionId, inputRows })
	}
	execute(id: string, versionId: string, inputRows: Record<string, BatchValue>[], clientRequestId: string) {
		return this.request(`/marketListings/${encodeURIComponent(id)}:execute`, {
			listingVersionId: versionId,
			inputRows,
			clientRequestId,
			confirm: true,
		})
	}
	async models(stepType: string) {
		if (!BATCH_MODEL_STEP_TYPES.some((step) => step === stepType)) throw new Error("模型类型未声明。")
		const data = await this.request(`/models?${new URLSearchParams({ stepType })}`)
		const items: unknown = data.models ?? data.items ?? []
		if (!Array.isArray(items)) throw new Error("模型列表响应不完整，请稍后重试。")
		const models = new Map<string, { id: string; name: string }>()
		for (const item of items) {
			if (!item || typeof item !== "object") continue
			const id = item.modelId
			if (typeof id !== "string" || !id || /\s/.test(id)) continue
			if (
				"supportedStepTypes" in item &&
				(!Array.isArray(item.supportedStepTypes) || !item.supportedStepTypes.includes(stepType))
			)
				continue
			if (!models.has(id))
				models.set(id, {
					id,
					name: typeof item.displayName === "string" && item.displayName.trim() ? item.displayName : id,
				})
		}
		return [...models.values()]
	}
	async upload(filename: string, contentType: string, content: string) {
		const data = await this.request("/inputAssets:upload", { filename, contentType, content })
		if (typeof data.inputAssetId !== "string" || !data.inputAssetId) throw new Error("上传未返回有效文件标识。")
		return data.inputAssetId as string
	}
	async run(id: string) {
		const route = `/users/me/runs/${encodeURIComponent(id)}`
		const detail = await this.request(route)
		if (!detail.run || typeof detail.run.status !== "string") throw new Error("运行状态响应不完整，已保留运行标识。")
		const rows: BatchResultRow[] = []
		let pageToken = ""
		const seen = new Set<string>()
		do {
			if (seen.has(pageToken)) throw new Error("结果分页异常，请稍后刷新。")
			seen.add(pageToken)
			const page = await this.request(`${route}/resultRows?${new URLSearchParams({ pageSize: "200", pageToken })}`)
			if (page.items !== undefined && !Array.isArray(page.items)) throw new Error("运行结果分页格式无效。")
			rows.push(...(page.items ?? []).map(publicResultRow))
			pageToken = String(page.nextPageToken || "")
		} while (pageToken)
		return {
			status: detail.run.status as string,
			total: Number(detail.run.totalTasks ?? rows.length),
			completed: Number(detail.run.completedTasks ?? 0),
			failed: Number(detail.run.failedTasks ?? 0),
			cancelled: Number(detail.run.cancelledTasks ?? 0),
			startedAt:
				typeof detail.run.startedAtUnix === "number" && detail.run.startedAtUnix > 0
					? detail.run.startedAtUnix * 1000
					: undefined,
			completedAt:
				typeof detail.run.completedAtUnix === "number" && detail.run.completedAtUnix > 0
					? detail.run.completedAtUnix * 1000
					: undefined,
			updatedAt: Date.now(),
			tasks: Array.isArray(detail.tasks)
				? detail.tasks.map((task: ObjectValue) => ({
						taskId: String(task.taskId || ""),
						sourceRowIndex: typeof task.sourceRowIndex === "number" ? task.sourceRowIndex : undefined,
						status: String(task.status || "unknown"),
						errorMessage: typeof task.errorMessage === "string" ? task.errorMessage : undefined,
						artifactCount: typeof task.artifactCount === "number" ? task.artifactCount : undefined,
					}))
				: [],
			rows,
			artifacts: rows.flatMap((row) => row.artifacts ?? []),
			listingId: (detail.market?.listingId ?? detail.run.market?.listingId) as string | undefined,
		}
	}
}
