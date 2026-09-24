import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import type { LoomLoomClient } from "./client"
import { LoomLoomRequestNotSubmittedError } from "./errors"

const remoteId = z
	.string()
	.min(1)
	.max(200)
	.regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/)
const text = (max: number) => z.string().trim().min(1).max(max)
const spec = z.record(z.string(), z.unknown())
const specVersion = z.literal("template-spec/v2")
const money = z.object({
	amount: z
		.string()
		.max(32)
		.regex(/^\d+(?:\.\d{1,7})?$/),
	currency: z.string().regex(/^[A-Z]{3}$/),
})
const creatorCommand = z.discriminatedUnion("action", [
	z.object({ action: z.literal("loadDraft") }),
	z.object({
		action: z.literal("saveDraft"),
		draft: z.record(z.string(), z.unknown()),
		expectedUpdatedAt: z.number().int().positive().nullable().optional(),
	}),
	z.object({ action: z.literal("context") }),
	z.object({
		action: z.literal("resolveCapabilities"),
		inputModalities: z.array(z.string().min(1).max(60)).min(1).max(8),
		outputModality: z.string().min(1).max(60),
		modelId: z.string().min(1).max(200).optional(),
	}),
	z.object({ action: z.literal("listTemplates"), pageOffset: z.number().int().nonnegative().optional() }),
	z.object({ action: z.literal("versions"), templateId: remoteId }),
	z.object({ action: z.literal("versionSpec"), templateId: remoteId, versionId: remoteId }),
	z.object({ action: z.literal("validate"), specVersion, canonicalSpecV2: spec }),
	z.object({
		action: z.literal("createTemplate"),
		name: text(120),
		description: z.string().max(4000),
		confirm: z.literal(true),
	}),
	z.object({
		action: z.literal("saveVersion"),
		templateId: remoteId,
		specVersion,
		canonicalSpecV2: spec,
		versionNote: z.string().max(500).default(""),
		confirm: z.literal(true),
	}),
	z.object({
		action: z.literal("publish"),
		templateId: remoteId,
		versionId: remoteId,
		displayName: text(120),
		description: z.string().max(4000),
		taskFixedFee: money,
		listingId: remoteId.optional(),
		confirm: z.literal(true),
	}),
	z.object({ action: z.literal("review"), reviewRequestId: remoteId }),
	z.object({ action: z.literal("reviews") }),
	z.object({ action: z.literal("listings") }),
	z.object({ action: z.literal("earnings") }),
	z.object({ action: z.literal("privateRunStatus"), runId: remoteId, templateId: remoteId, versionId: remoteId }),
	z.object({ action: z.literal("uploadPrivateInput"), jsonl: z.string().min(1).max(900_000) }),
	z.object({ action: z.literal("precheckPrivate"), templateId: remoteId, versionId: remoteId, inputFileId: remoteId }),
	z.object({
		action: z.literal("runPrivate"),
		templateId: remoteId,
		versionId: remoteId,
		inputFileId: remoteId,
		expectedEstimatedCostT: z.number().int().nonnegative(),
		expectedPricingRevision: text(200),
		confirm: z.literal(true),
	}),
])

export type CreatorCommand = z.infer<typeof creatorCommand>

export function parseCreatorCommand(value: string): { taskId: string; command: CreatorCommand } {
	if (value.length > 1_000_000) throw new Error("创建模式请求过大，请缩小内容。")
	return z.object({ taskId: z.string().min(1).max(200), command: creatorCommand }).parse(JSON.parse(value))
}

type Precheck = { amountT: number; pricingRevision: string }
type RunAttempt = {
	key: string
	clientRequestId: string
	createdAt: number
	runId?: string
}

/** Explicit human creator commands. Private paid test runs require an exact precheck and a durable one-shot guard. */
export class CreatorService {
	private readonly prechecks = new Map<string, Precheck>()
	private attempts?: RunAttempt[]
	private runSerial: Promise<unknown> = Promise.resolve()
	private draftSerial: Promise<unknown> = Promise.resolve()
	private readonly draftListeners = new Map<
		string,
		Set<(event: { draft: Record<string, unknown>; updatedAt: number }) => void>
	>()

	constructor(
		private readonly client: LoomLoomClient,
		private readonly storageDirectory: string,
	) {}

	private inputKey(templateId: string, versionId: string, inputFileId: string) {
		return JSON.stringify([templateId, versionId, inputFileId])
	}

	private draftPath(taskId: string) {
		const digest = createHash("sha256").update(taskId).digest("hex")
		return path.join(this.storageDirectory, "drafts", `${digest}.json`)
	}

	subscribeDraft(taskId: string, listener: (event: { draft: Record<string, unknown>; updatedAt: number }) => void): () => void {
		const listeners = this.draftListeners.get(taskId) ?? new Set()
		listeners.add(listener)
		this.draftListeners.set(taskId, listeners)
		return () => {
			listeners.delete(listener)
			if (!listeners.size) this.draftListeners.delete(taskId)
		}
	}

	private async loadDraft(taskId: string): Promise<{ draft: Record<string, unknown> | null; updatedAt: number | null }> {
		try {
			const raw = await readFile(this.draftPath(taskId), "utf8")
			const stored: unknown = JSON.parse(raw)
			if (!stored || typeof stored !== "object" || !("draft" in stored) || !("updatedAt" in stored))
				throw new Error("创作草稿格式无效，请检查本地存储。")
			const { draft, updatedAt } = stored
			if (
				!draft ||
				typeof draft !== "object" ||
				Array.isArray(draft) ||
				!Number.isSafeInteger(updatedAt) ||
				(updatedAt as number) <= 0
			)
				throw new Error("创作草稿格式无效，请检查本地存储。")
			return { draft: draft as Record<string, unknown>, updatedAt: updatedAt as number }
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { draft: null, updatedAt: null }
			throw error
		}
	}

	private async saveDraft(taskId: string, draft: Record<string, unknown>, expectedUpdatedAt?: number | null) {
		const current = await this.loadDraft(taskId)
		if (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt)
			throw new Error("创作草稿已被另一侧更新。请核对后选择保留本地编辑或载入最新草稿。")
		const forbidden =
			/^(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|authorization|bearer|password|secret|credential)$/i
		const pending: unknown[] = [draft]
		while (pending.length) {
			const value = pending.pop()
			if (!value || typeof value !== "object") continue
			for (const [key, child] of Object.entries(value)) {
				if (forbidden.test(key) && child !== null && child !== undefined && child !== "")
					throw new Error("创作草稿不能包含凭据；请移除令牌或密码后重试。")
				if (child && typeof child === "object") pending.push(child)
			}
		}
		const payload = { draft, updatedAt: Math.max(Date.now(), (current.updatedAt ?? 0) + 1) }
		const serialized = JSON.stringify(payload)
		if (Buffer.byteLength(serialized, "utf8") > 900_000) throw new Error("创作草稿过大，请缩小内容。")
		const target = this.draftPath(taskId)
		await mkdir(path.dirname(target), { recursive: true })
		const temporary = `${target}.${randomUUID()}.tmp`
		await writeFile(temporary, serialized, { mode: 0o600 })
		await rename(temporary, target)
		return payload
	}

	/** Model authority is limited to business design fields, never remote IDs, fees or approvals. */
	async patchDesign(
		taskId: string,
		expectedUpdatedAt: number | null,
		patch: {
			name?: string
			description?: string
			instruction?: string
			samplePrompt?: string
			mode?: "simple" | "advanced"
			advancedJson?: string
			profileId?: string
			modelId?: string
		},
	) {
		const next = this.draftSerial.then(
			async () => {
				const current = await this.loadDraft(taskId)
				if (current.updatedAt !== expectedUpdatedAt) throw new Error("创作草稿已更新，请重新读取后再修改。")
				const draft = {
					...(current.draft ?? { version: 1, mode: "simple", name: "", advancedJson: "" }),
					...patch,
					validatedSpecJson: "",
					inputFileId: "",
					precheck: null,
				}
				return this.saveDraft(taskId, draft, expectedUpdatedAt)
			},
			async () => {
				throw new Error("创作草稿正在更新，请稍后重试。")
			},
		)
		this.draftSerial = next.catch(() => undefined)
		const saved = await next
		for (const listener of this.draftListeners.get(taskId) ?? []) {
			try {
				listener({ draft: saved.draft, updatedAt: saved.updatedAt })
			} catch {
				/* Closing an editor cannot undo a saved design change. */
			}
		}
		return saved
	}

	private async loadAttempts() {
		if (this.attempts) return this.attempts
		try {
			const file = await readFile(path.join(this.storageDirectory, "private-run-attempts.json"), "utf8")
			const parsed: unknown = JSON.parse(file)
			this.attempts = Array.isArray(parsed)
				? parsed.filter(
						(item): item is RunAttempt =>
							item &&
							typeof item.key === "string" &&
							typeof item.clientRequestId === "string" &&
							Number.isSafeInteger(item.createdAt),
					)
				: []
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
			this.attempts = []
		}
		return this.attempts
	}

	private async saveAttempts() {
		await mkdir(this.storageDirectory, { recursive: true })
		const target = path.join(this.storageDirectory, "private-run-attempts.json")
		const temporary = `${target}.${randomUUID()}.tmp`
		await writeFile(temporary, JSON.stringify(this.attempts), { mode: 0o600 })
		await rename(temporary, target)
	}

	private async oneRun<T>(operation: () => Promise<T>): Promise<T> {
		const next = this.runSerial.then(operation, operation)
		this.runSerial = next.catch(() => undefined)
		return next
	}

	async execute(command: CreatorCommand, taskId?: string): Promise<Record<string, unknown>> {
		switch (command.action) {
			case "loadDraft":
				if (!taskId) throw new Error("创作草稿必须绑定当前会话。")
				return this.loadDraft(taskId)
			case "saveDraft": {
				if (!taskId) throw new Error("创作草稿必须绑定当前会话。")
				const next = this.draftSerial.then(
					() => this.saveDraft(taskId, command.draft, command.expectedUpdatedAt),
					() => this.saveDraft(taskId, command.draft, command.expectedUpdatedAt),
				)
				this.draftSerial = next.catch(() => undefined)
				return next
			}
			case "context":
				return this.client.creatorContext()
			case "resolveCapabilities":
				return this.client.creatorResolveCapabilities(command.inputModalities, command.outputModality, command.modelId)
			case "listTemplates":
				return this.client.creatorTemplates(command.pageOffset)
			case "versions":
				return this.client.creatorVersions(command.templateId)
			case "versionSpec":
				return this.client.creatorVersionSpec(command.templateId, command.versionId)
			case "validate":
				return this.client.creatorValidate(command.canonicalSpecV2)
			case "createTemplate": {
				const result = await this.client.creatorCreateTemplate(command.name, command.description)
				if (typeof result.templateId !== "string" || !result.templateId)
					throw new Error("创建请求状态未知，请先查看我的工作流。")
				return result
			}
			case "saveVersion": {
				const checked = await this.client.creatorValidate(command.canonicalSpecV2)
				if (checked.valid !== true) throw new Error("工作流定义未通过服务端校验，尚未保存新版本。")
				const result = await this.client.creatorSaveVersion(
					command.templateId,
					command.canonicalSpecV2,
					command.versionNote,
				)
				if (typeof result.versionId !== "string" || !result.versionId)
					throw new Error("保存请求状态未知，请先查看版本列表。")
				return result
			}
			case "publish": {
				const result = await this.client.creatorPublish({
					templateId: command.templateId,
					templateVersionId: command.versionId,
					displayName: command.displayName,
					description: command.description,
					taskFixedFee: command.taskFixedFee,
					...(command.listingId ? { listingId: command.listingId } : {}),
				})
				if (typeof result.reviewRequestId !== "string" || !result.reviewRequestId)
					throw new Error("上架申请状态未知，请查看创作者审核记录后再操作。")
				return result
			}
			case "review":
				return this.client.creatorReview(command.reviewRequestId)
			case "reviews":
				return this.client.creatorReviews()
			case "listings":
				return this.client.creatorListings()
			case "earnings":
				return this.client.creatorEarnings()
			case "privateRunStatus": {
				const [detail, versions] = await Promise.all([
					this.client.creatorRunStatus(command.runId),
					this.client.creatorVersions(command.templateId),
				])
				const run = detail.run
				const version = Array.isArray(versions.items)
					? versions.items.find((item: Record<string, unknown>) => item.versionId === command.versionId)
					: undefined
				if (
					!run ||
					run.templateUuid !== command.templateId ||
					!version ||
					typeof version.definitionHash !== "string" ||
					!version.definitionHash ||
					run.definitionHash !== version.definitionHash
				)
					throw new Error("运行记录与所选私有工作流版本不匹配，不能作为上架前的测试凭据。")
				return detail
			}
			case "uploadPrivateInput": {
				const lines = command.jsonl.split(/\r?\n/).filter((line) => line.trim())
				if (lines.length < 1 || lines.length > 1000) throw new Error("测试输入需包含 1–1000 条 JSONL 输入行。")
				for (const line of lines) {
					let value: unknown
					try {
						value = JSON.parse(line)
					} catch {
						throw new Error("测试输入不是有效的 JSONL。")
					}
					if (!value || typeof value !== "object" || Array.isArray(value))
						throw new Error("每条测试输入必须是 JSON 对象。")
				}
				const result = await this.client.creatorUploadInput(
					"cline-creator-input.jsonl",
					Buffer.from(`${lines.join("\n")}\n`, "utf8").toString("base64"),
				)
				if (
					typeof result.inputFileId !== "string" ||
					!result.inputFileId ||
					!Number.isSafeInteger(result.rowCount) ||
					result.rowCount !== lines.length
				)
					throw new Error("上传状态未知，请重新准备测试输入。")
				return result
			}
			case "precheckPrivate": {
				const result = await this.client.creatorPrecheck(command.templateId, command.versionId, command.inputFileId)
				if (
					!Number.isSafeInteger(result.estimatedTotalCostT) ||
					typeof result.pricingRevision !== "string" ||
					!result.pricingRevision
				)
					throw new Error("预算响应缺少费用或定价版本，不能运行。")
				this.prechecks.set(this.inputKey(command.templateId, command.versionId, command.inputFileId), {
					amountT: result.estimatedTotalCostT,
					pricingRevision: result.pricingRevision,
				})
				return result
			}
			case "runPrivate":
				return this.oneRun(async () => {
					const key = this.inputKey(command.templateId, command.versionId, command.inputFileId)
					const precheck = this.prechecks.get(key)
					if (
						!precheck ||
						precheck.amountT !== command.expectedEstimatedCostT ||
						precheck.pricingRevision !== command.expectedPricingRevision
					)
						throw new Error("预算已失效，请重新检查费用后确认运行。")
					const attempts = await this.loadAttempts()
					if (attempts.some((attempt) => attempt.key === key))
						throw new Error("同一份测试输入已提交或提交状态未知，请先核对运行记录；如需再测，请重新上传输入。")
					const attempt: RunAttempt = { key, clientRequestId: randomUUID(), createdAt: Date.now() }
					attempts.push(attempt)
					await this.saveAttempts()
					let result: Record<string, unknown>
					try {
						result = await this.client.creatorRun(command.templateId, {
							versionId: command.versionId,
							inputFileId: command.inputFileId,
							clientRequestId: attempt.clientRequestId,
							expectedEstimatedCostT: command.expectedEstimatedCostT,
							expectedPricingRevision: command.expectedPricingRevision,
						})
					} catch (error) {
						if (error instanceof LoomLoomRequestNotSubmittedError) {
							// The credential gate rejected this before transport. No remote request exists.
							attempts.splice(attempts.indexOf(attempt), 1)
							await this.saveAttempts()
						}
						throw error
					}
					if (typeof result.runId !== "string" || !result.runId) throw new Error("运行提交状态未知，请核对运行记录。")
					attempt.runId = result.runId
					await this.saveAttempts()
					return result
				})
		}
	}
}
