/** Public Batch contract. No API keys, hidden workflow definitions or executable Skill packages. */
export type BatchValue = string | number | boolean | null | BatchValue[] | { [key: string]: BatchValue }
export type ProductAgentMode = "plan" | "act" | "batch"
export interface BatchField {
	key: string
	label?: string
	description?: string
	value_type: string
	required?: boolean
	order?: number
	default_value?: BatchValue
	enum_values?: BatchValue[]
	accepted_mime_types?: string[]
	max_values?: number
	presentation?: { widget?: string; hint?: string }
	model_override?: { step_type: string; allow_override?: boolean; default_model_id?: string }
}
export interface BatchSchema {
	schema_version: string
	fields: BatchField[]
	input_summary?: string
	instructions?: string[] | string
}
export interface SkillBot {
	id: string
	name: string
	description: string
	versionId: string
	availability: string
	fee?: { amount: string; currency: string }
	schema?: BatchSchema
}
export interface BatchAttachment {
	id: string
	name: string
	/** Local source, readable only through the existing Cline file tool. Never submitted as a remote asset. */
	path: string
	field?: string
	inputAssetId?: string
	mode?: "reference" | "text" | "asset"
	mimeType?: string
	sizeBytes?: number
	sha256?: string
	/** Host-owned hash of the imported field value; avoids clearing a subsequent user edit. */
	importedValueHash?: string
}
export interface BatchRow {
	id: string
	values: Record<string, BatchValue>
	attachments: BatchAttachment[]
}
export interface BatchQuote {
	id: string
	revision: number
	hash: string
	versionId: string
	inputRows: Record<string, BatchValue>[]
	payable: { amount: string; currency: string }
	taskCount: number
	at: number
	valid: boolean
}
export interface BatchResultRow {
	rowIndex: number
	status: string
	errorMessage?: string
	stepErrors?: unknown[]
	artifacts?: BatchArtifact[]
}
export interface BatchArtifact {
	artifactId?: string
	sourceRowIndex?: number
	inlineText?: string
	accessUrl?: string
	portName?: string
	mimeType?: string
}
export interface BatchOutputDestination {
	/** Captured from the original task, never from cloud artifacts or the active editor. */
	baseDirectory: string
}
export interface BatchLocalOutput {
	runId: string
	rowIndex: number
	artifactIndex: number
	artifactId?: string
	contentHash: string
	status: "saved" | "error"
	path?: string
	relativePath?: string
	sha256?: string
	sizeBytes?: number
	extension?: string
	mimeType?: string
	error?: string
}
export interface BatchTaskStatus {
	taskId: string
	sourceRowIndex?: number
	status: string
	errorMessage?: string
	artifactCount?: number
}
export interface BatchProgress {
	status: string
	total: number
	completed: number
	failed: number
	cancelled?: number
	startedAt?: number
	completedAt?: number
	updatedAt?: number
}
export interface BatchHistoryRun {
	outputDestination?: BatchOutputDestination
	runId: string
	listingName: string
	listing?: SkillBot
	rows: BatchRow[]
	results: BatchResultRow[]
	phase: BatchPhase
	progress?: BatchProgress
	tasks?: BatchTaskStatus[]
	recordedAt?: number
	error?: string
}
export type BatchPhase =
	| "selecting"
	| "quantity"
	| "collecting"
	| "reviewing"
	| "quoting"
	| "quoted"
	| "submitting"
	| "execution-unknown"
	| "running"
	| "completed"
	| "partial-failure"
	| "failed"
export interface BatchEvent {
	actor?: "user" | "agent" | "system"
	id: string
	at: number
	text: string
}
export interface BatchSession {
	outputDestination?: BatchOutputDestination
	/** Local records stay separate from untrusted remote artifacts. */
	localOutputs?: BatchLocalOutput[]
	worksheet?: BatchWorksheetView
	agentContext?: { revision: number; phase: BatchPhase; preparedAt: number }
	pastRuns?: BatchHistoryRun[]
	version: 1
	id: string
	taskId: string
	enabled: boolean
	revision: number
	phase: BatchPhase
	listing?: SkillBot
	rows: BatchRow[]
	quote?: BatchQuote
	attempt?: { requestId: string; quote: BatchQuote; runId?: string; outputDestination?: BatchOutputDestination }
	results: BatchResultRow[]
	artifacts: BatchArtifact[]
	progress?: BatchProgress
	tasks?: BatchTaskStatus[]
	error?: string
	events: BatchEvent[]
}
export interface BatchWorksheetView {
	sheet: string
	range: string
	wrap?: boolean
	freeze?: boolean
	gridlines?: boolean
	zoom?: number
	fontSize?: number
	columnWidths?: Record<string, number>
	boldRanges?: string[]
}
export interface BatchTableHostAction {
	taskId: string
	action: "focusChat" | "openArtifact" | "copyText" | "cite" | "saveOutputs"
	text?: string
	runId?: string
	rowIndex?: number
	artifactIndex?: number
}
/** Chat receives control/input context, not the potentially huge result/history payload. */
export type BatchChatSnapshot = Omit<
	BatchSession,
	"results" | "artifacts" | "pastRuns" | "tasks" | "quote" | "attempt" | "localOutputs"
> & {
	quote?: Omit<BatchQuote, "inputRows">
	attempt?: Omit<NonNullable<BatchSession["attempt"]>, "quote">
	pastRunCount?: number
	outputSummary?: { saved: number; failed: number; directory?: string }
}
export type BatchInputContext = Pick<BatchSession, "taskId" | "revision" | "listing" | "rows">
export interface BatchTableSnapshot {
	session: BatchSession | null
	editable: boolean
}
export function toBatchChatSnapshot(session: BatchSession | undefined): BatchChatSnapshot | undefined {
	if (!session) return undefined
	const {
		results: _results,
		artifacts: _artifacts,
		pastRuns,
		tasks: _tasks,
		quote,
		attempt,
		localOutputs,
		...context
	} = session
	const { inputRows: _inputRows, ...quoteSummary } = quote ?? ({} as BatchQuote)
	return {
		...context,
		quote: quote ? (quoteSummary as Omit<BatchQuote, "inputRows">) : undefined,
		attempt: attempt ? { requestId: attempt.requestId, runId: attempt.runId } : undefined,
		pastRunCount: pastRuns?.length ?? 0,
		outputSummary: attempt?.runId
			? {
					saved: localOutputs?.filter((file) => file.runId === attempt.runId && file.status === "saved").length ?? 0,
					failed: localOutputs?.filter((file) => file.runId === attempt.runId && file.status === "error").length ?? 0,
					directory: attempt.outputDestination?.baseDirectory ?? session.outputDestination?.baseDirectory,
				}
			: undefined,
	}
}
export type BatchCommand =
	| { action: "mode"; mode: ProductAgentMode }
	| { action: "select"; listingId: string; revision?: number }
	| { action: "quantity"; count: number; revision: number }
	| { action: "addRows"; count: number; revision: number }
	| { action: "removeRows"; rowIds: string[]; revision: number }
	| { action: "patch"; revision: number; rows: { id: string; values: Record<string, BatchValue> }[] }
	| { action: "removeAttachment"; revision: number; rowId: string; attachmentId: string }
	| { action: "review" | "revise" | "quote"; revision: number }
	| { action: "execute"; revision: number; quoteId: string }
	| { action: "refreshRun" }
	| { action: "recoverRun"; runId: string }
	| { action: "newBatch"; revision?: number; keepListing?: boolean }

export function parseBatchSchema(snapshot: unknown): BatchSchema {
	const schema = typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot
	if (!schema || schema.schema_version !== "loom_market_public_input_schema_v1" || !Array.isArray(schema.fields)) {
		throw new Error("暂不支持此 SkillBot 的输入格式，请刷新或联系发布者。")
	}
	const keys = new Set<string>()
	for (const field of schema.fields) {
		if (
			!field ||
			typeof field.key !== "string" ||
			!field.key ||
			["__proto__", "constructor", "prototype"].includes(field.key) ||
			keys.has(field.key)
		) {
			throw new Error("SkillBot 输入字段不合法。")
		}
		if (
			!["string", "enum", "image_url", "integer", "number", "boolean", "asset_ref", "text_reference"].includes(
				field.value_type,
			)
		) {
			throw new Error(`暂不支持输入类型 ${field.value_type}，不会自动改成文本提交。`)
		}
		keys.add(field.key)
	}
	return schema as BatchSchema
}

/** Empty optional values are omitted so the SkillBot owns its recommended defaults. */
export function canonicalRows(session: Pick<BatchSession, "listing" | "rows">): Record<string, BatchValue>[] {
	const fields = session.listing?.schema?.fields
	if (!fields || !session.rows.length) throw new Error("请先选择 SkillBot 并添加至少一行输入。")
	return session.rows.map((row, index) => {
		const result: Record<string, BatchValue> = {}
		for (const field of [...fields].sort((a, b) => a.key.localeCompare(b.key))) {
			let value = row.values[field.key]
			if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
				if (field.required) throw new Error(`第 ${index + 1} 条缺少「${field.label || field.key}」。`)
				continue
			}
			if (field.value_type === "integer" || field.value_type === "number") {
				if (typeof value === "string" && value.trim()) value = Number(value)
				if (
					typeof value !== "number" ||
					!Number.isFinite(value) ||
					(field.value_type === "integer" && !Number.isInteger(value))
				)
					throw new Error(`第 ${index + 1} 条「${field.label || field.key}」需要有效数字。`)
			} else if (field.value_type === "boolean") {
				if (typeof value !== "boolean") throw new Error(`「${field.label || field.key}」需要选择是或否。`)
			} else if (field.value_type === "asset_ref") {
				if (!row.attachments.some((a) => a.field === field.key && a.inputAssetId === value))
					throw new Error(`第 ${index + 1} 条「${field.label || field.key}」需要通过附件按钮上传。`)
			} else if (typeof value !== "string") {
				throw new Error(`「${field.label || field.key}」需要文本。`)
			}
			if (field.enum_values?.length && !field.enum_values.includes(value))
				throw new Error(`「${field.label || field.key}」不在可选范围内。`)
			result[field.key] = value
		}
		return result
	})
}
