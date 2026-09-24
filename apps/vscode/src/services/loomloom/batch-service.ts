import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import {
	type BatchAttachment,
	type BatchChatSnapshot,
	type BatchCommand,
	type BatchLocalOutput,
	type BatchSession,
	type BatchWorksheetView,
	canonicalRows,
	toBatchChatSnapshot,
} from "@shared/loomloom"
import { getBatchFileInputMode } from "@shared/loomloom-files"
import { resolveBatchModelField } from "@shared/loomloom-models"
import type { BatchApi } from "./client"
import { LoomLoomRequestNotSubmittedError } from "./errors"

const LOCKED = new Set(["submitting", "running", "execution-unknown"])
const TERMINAL = new Set([
	"completed",
	"succeeded",
	"success",
	"failed",
	"cancelled",
	"canceled",
	"partially_failed",
	"partially_cancelled",
	"partial_cancelled",
	"partial_failed",
	"partial_failure",
	"partial-failure",
])
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
export interface BatchPresentationIntent {
	taskId: string
	batchId: string
	firstRowId: string
	runId?: string
	reason: "select" | "quantity" | "newBatch" | "addRows" | "review" | "revise" | "run" | "resume"
}
export interface BatchResultsAvailableIntent {
	taskId: string
	runId: string
}
export interface BatchStore {
	loadAll(): Promise<BatchSession[]>
	save(session: BatchSession): Promise<void>
}
export class FileBatchStore implements BatchStore {
	constructor(private readonly directory: string) {}
	async loadAll() {
		await mkdir(this.directory, { recursive: true })
		const sessions: BatchSession[] = []
		const names = (await readdir(this.directory)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name))
		// Restoring every saved task is required for background run polling. Read
		// a small bounded group at a time so first-use Batch does not wait for a
		// serial filesystem round trip per historical task.
		for (let offset = 0; offset < names.length; offset += 8) {
			const group = await Promise.all(
				names.slice(offset, offset + 8).map(async (name) => {
					const value = JSON.parse(await readFile(path.join(this.directory, name), "utf8")) as BatchSession
					if (value.version !== 1 || !value.taskId || !Array.isArray(value.rows))
						throw new Error("Batch 本地状态格式不兼容，请保留文件并联系研发。")
					return value
				}),
			)
			sessions.push(...group)
		}
		return sessions
	}
	async save(session: BatchSession) {
		await mkdir(this.directory, { recursive: true })
		const target = path.join(this.directory, `${hash(session.taskId)}.json`)
		const temporary = `${target}.${randomUUID()}.tmp`
		await writeFile(temporary, JSON.stringify(session), { mode: 0o600 })
		await rename(temporary, target)
	}
}

/** Authority for edits, estimates and paid attempts. UI and Agent both edit this same draft. */
export class BatchService {
	private sessions = new Map<string, BatchSession>()
	private queues = new Map<string, Promise<unknown>>()
	private timers = new Map<string, ReturnType<typeof setTimeout>>()
	private disposed = false
	private observed = new Map<string, NonNullable<BatchSession["agentContext"]>>()
	private listeners = new Map<string, Set<(snapshot: BatchSession) => void>>()
	private worksheetViewListeners = new Map<string, Set<(view: BatchWorksheetView) => void>>()
	private presentationListeners = new Set<(intent: BatchPresentationIntent) => void>()
	private resultsListeners = new Set<(intent: BatchResultsAvailableIntent) => void>()
	readonly ready: Promise<void>
	constructor(
		private readonly store: BatchStore,
		private readonly api: BatchApi,
		private readonly changed: () => void,
		private readonly pollMs = 3000,
	) {
		this.ready = this.restore()
	}
	private async restore() {
		for (const session of await this.store.loadAll()) {
			if (session.phase === "submitting") {
				session.phase = "execution-unknown"
				session.error = "上次提交结果不确定，请核对运行记录；不会自动重复提交。"
			}
			if (session.phase === "quoting") session.phase = "reviewing"
			this.sessions.set(session.taskId, session)
			if (session.phase === "running" && session.attempt?.runId) this.schedule(session.taskId)
		}
	}
	async snapshot(taskId: string | undefined): Promise<BatchSession | undefined> {
		// A fresh Cline conversation has no Batch state. Do not hold its initial
		// webview state behind restoration of every historical Batch run.
		if (!taskId) return undefined
		await this.ready
		const state = this.sessions.get(taskId)
		return state ? structuredClone({ ...state, agentContext: this.observed.get(state.taskId) }) : undefined
	}
	/** The sidebar never needs full results, artifacts or history on every state push. */
	async chatSnapshot(taskId: string | undefined): Promise<BatchChatSnapshot | undefined> {
		if (!taskId) return undefined
		await this.ready
		const state = this.sessions.get(taskId)
		if (!state) return undefined
		// Project before cloning: large result payloads stay exclusively in the
		// worksheet channel, while rows remain editable from the chat.
		return structuredClone(toBatchChatSnapshot({ ...state, agentContext: this.observed.get(taskId) }))
	}
	observeAgentContext(taskId: string, revision: number, phase: BatchSession["phase"]) {
		const previous = this.observed.get(taskId)
		if (previous?.revision === revision && previous.phase === phase) return
		this.observed.set(taskId, { revision, phase, preparedAt: Date.now() })
		this.changed()
		this.notify(taskId)
	}
	subscribe(taskId: string, listener: (snapshot: BatchSession) => void): () => void {
		const listeners = this.listeners.get(taskId) ?? new Set()
		listeners.add(listener)
		this.listeners.set(taskId, listeners)
		return () => {
			listeners.delete(listener)
			if (!listeners.size) this.listeners.delete(taskId)
		}
	}
	/** Small selection/format updates use a separate channel from full batch snapshots. */
	subscribeWorksheetView(taskId: string, listener: (view: BatchWorksheetView) => void): () => void {
		const listeners = this.worksheetViewListeners.get(taskId) ?? new Set()
		listeners.add(listener)
		this.worksheetViewListeners.set(taskId, listeners)
		return () => {
			listeners.delete(listener)
			if (!listeners.size) this.worksheetViewListeners.delete(taskId)
		}
	}
	/** Re-evaluate task-pinned view permissions without changing drafts, modes or runs. */
	notifyActiveTaskChanged(previousTaskId: string | undefined, taskId: string | undefined): void {
		if (this.disposed || previousTaskId === taskId) return
		for (const id of new Set([previousTaskId, taskId])) {
			if (id) this.notify(id)
		}
	}
	subscribePresentation(listener: (intent: BatchPresentationIntent) => void): () => void {
		this.presentationListeners.add(listener)
		return () => this.presentationListeners.delete(listener)
	}
	subscribeResultsAvailable(listener: (intent: BatchResultsAvailableIntent) => void): () => void {
		this.resultsListeners.add(listener)
		return () => this.resultsListeners.delete(listener)
	}
	private resultsAvailable(taskId: string, runId: string) {
		if (this.disposed) return
		for (const listener of this.resultsListeners) {
			try {
				listener({ taskId, runId })
			} catch {
				/* Local output failures must not change a persisted remote run. */
			}
		}
	}
	/** Called with the original task's host-resolved workspace, never a current editor or cloud path. */
	async configureOutputDestination(taskId: string, baseDirectory: string, bindUnboundRunId?: string, notifyState = true) {
		if (!baseDirectory || !path.isAbsolute(baseDirectory)) throw new Error("输出目录必须是原任务的绝对路径。")
		return this.exclusive(taskId, async () => {
			const session = this.session(taskId)
			const run = !bindUnboundRunId
				? undefined
				: session.attempt?.runId === bindUnboundRunId
					? session.attempt
					: session.pastRuns?.find((past) => past.runId === bindUnboundRunId)
			if (bindUnboundRunId && !run) throw new Error("此运行不属于当前任务，不能绑定输出目录。")
			const previousDestination = session.outputDestination
			const previousRunDestination = run?.outputDestination
			session.outputDestination ??= { baseDirectory: path.resolve(baseDirectory) }
			// Only an explicit export may bind a legacy run that has never had a destination.
			if (run && !run.outputDestination) run.outputDestination = structuredClone(session.outputDestination)
			if (previousDestination && (!run || previousRunDestination)) return structuredClone(session.outputDestination)
			try {
				await this.persist(session, notifyState)
			} catch (error) {
				session.outputDestination = previousDestination
				if (run) run.outputDestination = previousRunDestination
				throw error
			}
			return structuredClone(session.outputDestination)
		})
	}
	/** Host-owned local records are separate from the replaceable cloud result payload. */
	async recordLocalOutputs(taskId: string, runId: string, records: BatchLocalOutput[]) {
		return this.exclusive(taskId, async () => {
			const session = this.session(taskId)
			if (session.attempt?.runId !== runId && !session.pastRuns?.some((run) => run.runId === runId))
				throw new Error("此运行不属于当前任务，不能保存本地产物记录。")
			for (const record of records) {
				if (
					record.runId !== runId ||
					!Number.isSafeInteger(record.rowIndex) ||
					record.rowIndex < 0 ||
					!Number.isSafeInteger(record.artifactIndex) ||
					record.artifactIndex < 0
				)
					throw new Error("本地产物记录的运行或位置无效。")
			}
			const previous = session.localOutputs
			const merged = [...(previous ?? [])]
			for (const record of records) {
				const index = merged.findIndex(
					(item) =>
						item.runId === runId && item.rowIndex === record.rowIndex && item.artifactIndex === record.artifactIndex,
				)
				if (index < 0) merged.push(structuredClone(record))
				else merged[index] = structuredClone(record)
			}
			if (JSON.stringify(previous ?? []) === JSON.stringify(merged)) return
			session.localOutputs = merged
			try {
				await this.persist(session)
			} catch (error) {
				session.localOutputs = previous
				throw error
			}
		})
	}
	private present(session: BatchSession, reason: BatchPresentationIntent["reason"]) {
		if (this.disposed || !session.enabled || !session.rows.length) return
		for (const listener of this.presentationListeners) {
			try {
				listener({
					taskId: session.taskId,
					batchId: session.id,
					firstRowId: session.rows[0].id,
					runId: session.attempt?.runId,
					reason,
				})
			} catch {
				/* Presentation cannot change the outcome of a persisted domain command. */
			}
		}
	}
	private notify(taskId: string) {
		const session = this.sessions.get(taskId)
		if (!session) return
		for (const listener of this.listeners.get(taskId) ?? []) {
			try {
				listener(structuredClone({ ...session, agentContext: this.observed.get(taskId) }))
			} catch {
				/* A closed view cannot stop the run. */
			}
		}
	}
	private async exclusive<T>(taskId: string, fn: () => Promise<T>): Promise<T> {
		await this.ready
		const previous = this.queues.get(taskId) ?? Promise.resolve()
		const next = previous.catch(() => {}).then(fn)
		this.queues.set(taskId, next)
		try {
			return await next
		} finally {
			if (this.queues.get(taskId) === next) this.queues.delete(taskId)
		}
	}
	async updateWorksheet(taskId: string, view: BatchWorksheetView, accept?: (session: BatchSession) => boolean) {
		return this.exclusive(taskId, async () => {
			const session = this.session(taskId)
			if (accept && !accept(session)) return undefined
			if (JSON.stringify(session.worksheet) === JSON.stringify(view)) return structuredClone(view)
			session.worksheet = structuredClone(view)
			// A selection/format change belongs to the worksheet. Avoid rebuilding
			// Cline chat state or cloning the entire result history for every click.
			for (const listener of this.worksheetViewListeners.get(taskId) ?? []) {
				try {
					listener(structuredClone(view))
				} catch {
					/* A detached worksheet cannot block the user's selection. */
				}
			}
			return structuredClone(view)
		})
	}
	private session(taskId: string) {
		const session = this.sessions.get(taskId)
		if (!session) throw new Error("请先进入 Batch 模式。")
		return session
	}
	private event(session: BatchSession, text: string) {
		session.events.push({ id: randomUUID(), at: Date.now(), text })
	}
	private async persist(session: BatchSession, notifyState = true) {
		await this.store.save(session)
		if (notifyState) this.changed()
		this.notify(session.taskId)
	}
	private editable(session: BatchSession, revision: number) {
		if (!session.enabled) throw new Error("请先切换到 Batch 模式。")
		if (LOCKED.has(session.phase)) throw new Error("本次输入已提交或提交结果待核对，不能修改。")
		if (session.revision !== revision) throw new Error("输入已被更新，请使用最新检查表重试。")
	}
	private invalidate(session: BatchSession) {
		session.revision++
		if (session.quote?.valid) this.event(session, "输入已修改，之前的预算已失效。请重新检查并获取预算。")
		if (session.quote) session.quote.valid = false
		session.phase = "collecting"
		session.error = undefined
	}
	async setEnabled(taskId: string, enabled: boolean, originalWorkspace?: string, notifyState = true) {
		if (originalWorkspace && (!enabled || !path.isAbsolute(originalWorkspace)))
			throw new Error("Batch 原始工作区必须是绝对路径。")
		const resumed = await this.exclusive(taskId, async () => {
			let session = this.sessions.get(taskId)
			const wasEnabled = session?.enabled
			if (session && wasEnabled === enabled && (!originalWorkspace || session.outputDestination)) return undefined
			if (!session && enabled) {
				session = {
					version: 1,
					id: randomUUID(),
					taskId,
					enabled,
					revision: 0,
					phase: "selecting",
					rows: [],
					results: [],
					artifacts: [],
					events: [],
				}
				this.sessions.set(taskId, session)
				this.event(session, "已进入 Batch。选择已安装的 SkillBot 后，Cline 会在当前对话里协助准备批量输入。")
			}
			if (session) {
				session.enabled = enabled
				if (originalWorkspace && !session.outputDestination)
					session.outputDestination = { baseDirectory: path.resolve(originalWorkspace) }
				await this.persist(session, notifyState)
				if (enabled && !wasEnabled && session.rows.length) return structuredClone(session)
			}
			return undefined
		})
		if (resumed) this.present(resumed, "resume")
	}
	async command(taskId: string, command: Exclude<BatchCommand, { action: "mode" }>, actor: "user" | "agent" = "user") {
		const result = await this.exclusive(taskId, async () => {
			const s = this.session(taskId)
			if (
				actor === "agent" &&
				![
					"select",
					"quantity",
					"addRows",
					"removeRows",
					"patch",
					"review",
					"revise",
					"refreshRun",
					"removeAttachment",
				].includes(command.action)
			)
				throw new Error("Agent 只能准备和校验输入，报价与执行必须由用户确认。")
			const eventStart = s.events.length
			if (command.action === "refreshRun") {
				await this.poll(s)
				return structuredClone(s)
			}
			if (command.action === "recoverRun") {
				if (s.phase !== "execution-unknown" || !s.attempt) throw new Error("没有待核对的提交。")
				const run = await this.api.run(command.runId)
				if (!run.listingId || run.listingId !== s.listing?.id || run.total !== s.rows.length)
					throw new Error("该运行与当前 SkillBot 或任务数量不匹配，请核对。")
				s.attempt.runId = command.runId
				s.phase = "running"
				s.error = undefined
				this.event(s, "已关联用户核对后的运行记录。")
				await this.persist(s)
				this.schedule(taskId)
				return structuredClone(s)
			}
			if (command.action === "execute") {
				await this.execute(s, command)
				return structuredClone(s)
			}
			if (s.attempt && command.action !== "newBatch") throw new Error("已提交的输入不可修改，请开始新一批任务。")
			this.editable(s, "revision" in command ? (command.revision ?? s.revision) : s.revision)
			switch (command.action) {
				case "newBatch":
					if (!TERMINAL.has(s.phase) && s.attempt) throw new Error("请先核对当前任务状态。")
					if (s.attempt?.runId) {
						s.pastRuns ??= []
						s.pastRuns.push({
							runId: s.attempt.runId,
							listingName: s.listing?.name || "SkillBot",
							listing: structuredClone(s.listing),
							progress: structuredClone(s.progress),
							tasks: structuredClone(s.tasks),
							recordedAt: Date.now(),
							rows: structuredClone(s.rows),
							results: structuredClone(s.results),
							phase: s.phase,
							outputDestination: structuredClone(s.attempt.outputDestination),
						})
					}
					const keepListing = command.keepListing !== false && !!s.listing?.schema
					this.event(
						s,
						`开始新一批任务。${keepListing ? `继续使用 ${s.listing!.name}。` : "请选择工作流。"}${s.attempt?.runId ? `上一批运行：${s.attempt.runId}` : ""}`,
					)
					s.attempt = undefined
					s.quote = undefined
					s.rows = keepListing ? [{ id: randomUUID(), values: {}, attachments: [] }] : []
					if (!keepListing) s.listing = undefined
					s.results = []
					s.artifacts = []
					s.progress = undefined
					s.tasks = undefined
					s.error = undefined
					s.phase = keepListing ? "collecting" : "selecting"
					s.worksheet = { sheet: "current", range: "C2" }
					s.revision++
					break
				case "select": {
					const listing = await this.api.detail(command.listingId)
					if (listing.availability.toLowerCase() !== "available") throw new Error("此 SkillBot 当前不可执行。")
					if (s.attempt) throw new Error("请先点击开始新一批任务。")
					this.invalidate(s)
					s.listing = listing
					s.rows = [{ id: randomUUID(), values: {}, attachments: [] }]
					s.phase = "collecting"
					this.event(
						s,
						`已加载 ${listing.name}，已添加 1 行输入。可以在工作表继续新增行，或在对话中请 Cline 批量整理。`,
					)
					break
				}
				case "quantity": {
					if (!s.listing?.schema || !Number.isInteger(command.count) || command.count < 1 || command.count > 100)
						throw new Error("请选择 SkillBot，并输入 1～100 的整数。")
					if (command.count < s.rows.length) throw new Error("减少任务数量请在工作表中明确删除对应行。")
					if (command.count === s.rows.length) return structuredClone(s)
					this.invalidate(s)
					while (s.rows.length < command.count) s.rows.push({ id: randomUUID(), values: {}, attachments: [] })
					this.event(s, `本次准备 ${command.count} 条输入。可以直接聊天并引用文件，或逐条填写；完成后检查输入表。`)
					break
				}
				case "addRows": {
					if (!s.listing?.schema) throw new Error("请先选择 SkillBot。")
					if (!Number.isInteger(command.count) || command.count < 1 || s.rows.length + command.count > 100)
						throw new Error("单批最多 100 行，请减少新增数量。")
					this.invalidate(s)
					for (let index = 0; index < command.count; index++)
						s.rows.push({ id: randomUUID(), values: {}, attachments: [] })
					this.event(s, `已新增 ${command.count} 行，共 ${s.rows.length} 行输入。`)
					break
				}
				case "removeRows": {
					if (!s.listing?.schema) throw new Error("请先选择 SkillBot。")
					const ids = new Set(command.rowIds)
					if (
						!ids.size ||
						ids.size !== command.rowIds.length ||
						command.rowIds.some((id) => !s.rows.some((row) => row.id === id))
					)
						throw new Error("要删除的输入行不存在或重复，请刷新工作表。")
					if (
						actor === "agent" &&
						s.rows.some(
							(row) =>
								ids.has(row.id) &&
								(row.attachments.length > 0 ||
									Object.values(row.values).some((value) => value !== null && value !== "")),
						)
					)
						throw new Error("有内容的输入行只能由用户确认删除。")
					this.invalidate(s)
					s.rows = s.rows.filter((row) => !ids.has(row.id))
					this.event(s, `已删除 ${ids.size} 行，剩余 ${s.rows.length} 行输入。`)
					break
				}
				case "patch": {
					const fields = new Set(s.listing?.schema?.fields.map((f) => f.key) ?? [])
					for (const patch of command.rows) {
						const row = s.rows.find((row) => row.id === patch.id)
						if (!row) throw new Error("找不到对应输入行。")
						for (const key of Object.keys(patch.values)) if (!fields.has(key)) throw new Error(`未知输入字段：${key}`)
						// Validate partial edits at the authority, not only in the spreadsheet UI.
						canonicalRows({
							listing: {
								...s.listing!,
								schema: {
									...s.listing!.schema!,
									fields: s
										.listing!.schema!.fields.filter((field) => Object.hasOwn(patch.values, field.key))
										.map((field) => ({ ...field, required: false })),
								},
							},
							rows: [{ ...row, values: patch.values }],
						})
					}
					for (const field of s.listing?.schema?.fields ?? []) {
						const model = resolveBatchModelField(field)
						if (!model.isModel) continue
						const overrides = command.rows
							.map((row) => row.values[field.key])
							.filter((value) => value !== undefined && value !== null && value !== "")
						if (!overrides.length) continue
						if (!model.stepType || !model.allowOverride || !this.api.models)
							throw new Error("此模型字段未公开可选配置，请使用推荐默认。")
						const models = await this.api.models(model.stepType)
						if (overrides.some((value) => !models.some((model) => model.id === value)))
							throw new Error(`「${field.label || field.key}」必须使用支持模型列表中的 ID。`)
					}
					this.invalidate(s)
					for (const patch of command.rows)
						Object.assign(s.rows.find((row) => row.id === patch.id)!.values, patch.values)
					this.event(
						s,
						`${actor === "agent" ? "Cline 已整理" : "已修改"} ${command.rows.length} 条输入，检查表已同步。`,
					)
					break
				}
				case "removeAttachment": {
					const row = s.rows.find((r) => r.id === command.rowId)
					const attachment = row?.attachments.find((a) => a.id === command.attachmentId)
					if (!row || !attachment) throw new Error("附件不存在。")
					this.invalidate(s)
					row.attachments = row.attachments.filter((a) => a.id !== attachment.id)
					if (attachment.field && attachment.inputAssetId && attachment.inputAssetId === row.values[attachment.field])
						delete row.values[attachment.field]
					else if (
						attachment.field &&
						attachment.mode === "text" &&
						typeof row.values[attachment.field] === "string" &&
						attachment.importedValueHash === hash(row.values[attachment.field])
					)
						delete row.values[attachment.field]
					break
				}
				case "review":
					canonicalRows(s)
					s.phase = "reviewing"
					this.event(s, "输入已整理，请逐行检查。确认后才会获取预算。")
					break
				case "revise":
					this.invalidate(s)
					s.phase = "reviewing"
					break
				case "quote": {
					if (s.phase !== "reviewing") throw new Error("请先检查输入表，再确认获取预算。")
					canonicalRows(s)
					s.phase = "quoting"
					await this.persist(s)
					try {
						const current = await this.api.detail(s.listing!.id)
						if (current.versionId !== s.listing!.versionId || current.availability.toLowerCase() !== "available")
							throw new Error("SkillBot 版本或可用状态已变化，请重新选择并检查输入。")
						const inputRows = canonicalRows({ listing: current, rows: s.rows })
						const data = await this.api.quote(current.id, current.versionId, inputRows)
						const payable = data.estimatedBuyerPayable
						if (
							!payable ||
							typeof payable.amount !== "string" ||
							!payable.currency ||
							!Number.isFinite(Number(payable.amount)) ||
							Number(payable.amount) < 0 ||
							Number(data.taskCount) !== s.rows.length
						)
							throw new Error("报价金额、币种或任务数量不完整，不能确认执行。")
						if (data.listingVersionId && data.listingVersionId !== current.versionId)
							throw new Error("报价版本已变化，请重新选择 SkillBot。")
						s.listing = structuredClone(current)
						s.quote = {
							id: randomUUID(),
							revision: s.revision,
							hash: hash(inputRows),
							versionId: current.versionId,
							inputRows,
							payable,
							taskCount: s.rows.length,
							at: Date.now(),
							valid: true,
						}
						s.phase = "quoted"
						s.error = undefined
						this.event(s, "预算已返回。请确认费用后运行，或返回修改输入。")
					} catch (error) {
						s.phase = "reviewing"
						s.error = error instanceof Error ? error.message : "报价失败"
					}
					break
				}
			}
			for (const event of s.events.slice(eventStart)) event.actor = actor
			await this.persist(s)
			return structuredClone(s)
		})
		// Deliver only after the domain lock has completed. Native views may read or
		// update this same service, and must never block a paid execution transition.
		if (
			command.action === "select" ||
			command.action === "newBatch" ||
			command.action === "review" ||
			command.action === "revise" ||
			(command.action === "addRows" && result.rows.length === command.count)
		)
			this.present(result, command.action)
		else if ((command.action === "execute" || command.action === "recoverRun") && result.attempt?.runId)
			this.present(result, "run")
		if (command.action === "refreshRun" && result.attempt?.runId) this.resultsAvailable(taskId, result.attempt.runId)
		return result
	}
	async attach(taskId: string, revision: number, rowId: string, attachment: BatchAttachment, importedText?: string) {
		return this.exclusive(taskId, async () => {
			const s = this.session(taskId)
			this.editable(s, revision)
			if (s.attempt) throw new Error("已提交的输入不可修改。")
			const row = s.rows.find((r) => r.id === rowId)
			if (!row) throw new Error("输入行不存在。")
			let importedValue: string | undefined
			const attached = { ...attachment }
			// File contents can only enter an explicit compatible public input field.
			if (attached.field) {
				const field = s.listing?.schema?.fields.find((field) => field.key === attached.field)
				if (!field) throw new Error("文件对应的输入字段已不存在。")
				const mode = getBatchFileInputMode(field)
				if (mode === "asset" && attached.inputAssetId && importedText === undefined) {
					importedValue = attached.inputAssetId
					attached.mode = "asset"
					delete attached.importedValueHash
				} else if (mode === "text" && typeof importedText === "string" && !attached.inputAssetId) {
					importedValue = importedText
					attached.mode = "text"
					attached.importedValueHash = hash(importedText)
					const total = s.rows.reduce(
						(size, inputRow) =>
							size +
							Buffer.byteLength(
								JSON.stringify(
									inputRow.id === rowId ? { ...inputRow.values, [field.key]: importedText } : inputRow.values,
								),
								"utf8",
							),
						0,
					)
					if (total > 8 * 1024 * 1024)
						throw new Error("本地适配器当前限制每批文本输入最多 8 MiB，请减少内容或拆分批次；不会自动截断。")
				} else throw new Error("此字段不支持当前文件转换方式，请选择明确的文本或素材字段。")
			} else if (importedText !== undefined || attached.inputAssetId || (attached.mode && attached.mode !== "reference"))
				throw new Error("导入文件内容需要选择明确的文本或素材字段。")
			this.invalidate(s)
			row.attachments = row.attachments.filter(
				(a) => a.id !== attached.id && (!attached.field || a.field !== attached.field),
			)
			row.attachments.push(attached)
			if (attached.field && importedValue !== undefined) row.values[attached.field] = importedValue
			this.event(
				s,
				attached.mode === "text"
					? `已将 ${attached.name} 读取为文本并导入对应输入，工作表已同步。`
					: `已添加文件 ${attached.name}。`,
			)
			await this.persist(s)
		})
	}
	private async execute(s: BatchSession, command: Extract<BatchCommand, { action: "execute" }>) {
		// Repeated clicks never create a new paid attempt, even after a lost response.
		if (s.attempt) throw new Error("本次确认已提交。请查看运行状态或核对结果，不要重复执行。")
		const q = s.quote
		if (
			!s.enabled ||
			s.phase !== "quoted" ||
			!q?.valid ||
			q.id !== command.quoteId ||
			q.revision !== command.revision ||
			q.revision !== s.revision ||
			q.hash !== hash(canonicalRows(s))
		)
			throw new Error("预算已失效，请重新检查输入并报价。")
		if (Date.now() - q.at > 10 * 60_000) {
			q.valid = false
			s.phase = "reviewing"
			await this.persist(s)
			throw new Error("预算已过期，请重新报价。")
		}
		const listing = await this.api.detail(s.listing!.id)
		if (
			listing.availability.toLowerCase() !== "available" ||
			listing.versionId !== q.versionId ||
			JSON.stringify(listing.fee) !== JSON.stringify(s.listing!.fee)
		) {
			q.valid = false
			s.phase = "reviewing"
			await this.persist(s)
			throw new Error("SkillBot 版本或价格已更新，请重新选择并报价。")
		}
		// The random confirmation ID was already persisted with the quote. Reusing it
		// also deduplicates approval from two windows that loaded the same snapshot.
		const notSubmitted = async (message: string, cause: unknown): Promise<never> => {
			s.attempt = undefined
			s.phase = "quoted"
			s.error = `本次未提交。${message} 处理后请再次确认执行。`
			try {
				await this.persist(s)
			} catch {
				s.error += " 当前恢复状态尚未保存到本地，请先恢复本地存储。"
				this.changed()
				this.notify(s.taskId)
			}
			throw new Error(s.error, { cause })
		}
		s.attempt = { requestId: q.id, quote: structuredClone(q), outputDestination: structuredClone(s.outputDestination) }
		s.phase = "submitting"
		s.error = undefined
		try {
			await this.persist(s) // Persist BEFORE sending; a restart cannot mint another attempt.
		} catch (error) {
			await notSubmitted(`无法保存本地确认记录：${error instanceof Error ? error.message : "存储异常"}。`, error)
		}
		try {
			const result = await this.api.execute(s.listing!.id, q.versionId, q.inputRows, s.attempt.requestId)
			if (typeof result.runId !== "string" || !result.runId) throw new Error("响应未包含运行标识。")
			s.attempt.runId = result.runId
			s.phase = "running"
			s.error = undefined
			this.event(s, `已创建 ${s.rows.length} 个批量任务，正在执行。`)
		} catch (error) {
			if (error instanceof LoomLoomRequestNotSubmittedError) await notSubmitted(error.message, error)
			s.phase = "execution-unknown"
			s.error = "提交结果不确定。请在 LoomLoom 调用记录核对运行 ID 后关联；本次不会自动重发。"
		}
		await this.persist(s)
		if (s.phase === "running") this.schedule(s.taskId)
	}
	private schedule(taskId: string) {
		if (this.disposed || this.timers.has(taskId)) return
		const timer = setTimeout(() => {
			this.timers.delete(taskId)
			void this.command(taskId, { action: "refreshRun" }).catch(() => this.schedule(taskId))
		}, this.pollMs)
		timer.unref?.()
		this.timers.set(taskId, timer)
	}
	private async poll(s: BatchSession) {
		if (!s.attempt?.runId) throw new Error("暂无已确认的运行标识。")
		try {
			const result = await this.api.run(s.attempt.runId)
			const previousPhase = s.phase
			s.progress = this.progressOf(result)
			s.tasks = result.tasks
			s.results = result.rows
			s.artifacts = result.artifacts
			s.error = undefined
			const status = result.status.toLowerCase()
			if (TERMINAL.has(status)) {
				const failed =
					result.failed > 0 ||
					result.rows.some((r) => ["failed", "cancelled", "canceled"].includes(r.status.toLowerCase()))
				s.phase =
					status.startsWith("partial") || (failed && result.completed > 0)
						? "partial-failure"
						: failed || ["failed", "cancelled", "canceled"].includes(status)
							? "failed"
							: "completed"
				if (previousPhase !== s.phase)
					this.event(
						s,
						s.phase === "completed"
							? "批量任务已完成。结果可在当前对话中继续使用。"
							: "批量任务已结束，请检查逐行状态与失败原因。",
					)
			} else s.phase = "running"
		} catch (error) {
			s.error = `暂时无法更新状态：${error instanceof Error ? error.message : "网络异常"}。运行标识已保留。`
		}
		await this.persist(s)
		if (s.phase === "running") this.schedule(s.taskId)
	}
	private progressOf(result: Awaited<ReturnType<BatchApi["run"]>>) {
		return {
			status: result.status,
			total: result.total,
			completed: result.completed,
			failed: result.failed,
			cancelled: result.cancelled,
			startedAt: result.startedAt,
			completedAt: result.completedAt,
			updatedAt: result.updatedAt ?? Date.now(),
		}
	}
	async refreshHistory(taskId: string, runId: string) {
		await this.exclusive(taskId, async () => {
			const session = this.session(taskId),
				past = session.pastRuns?.find((run) => run.runId === runId)
			if (!past) throw new Error("此运行不属于当前表格的历史批次。")
			try {
				const result = await this.api.run(runId)
				past.results = result.rows
				past.progress = this.progressOf(result)
				past.tasks = result.tasks
				past.error = undefined
			} catch (error) {
				past.error = error instanceof Error ? error.message : "无法刷新历史结果"
			}
			await this.persist(session)
		})
		this.resultsAvailable(taskId, runId)
	}
	dispose() {
		this.disposed = true
		for (const timer of this.timers.values()) clearTimeout(timer)
		this.timers.clear()
		this.listeners.clear()
		this.worksheetViewListeners.clear()
		this.presentationListeners.clear()
		this.resultsListeners.clear()
	}
}
