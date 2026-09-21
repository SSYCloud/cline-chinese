import { EmptyRequest } from "@shared/proto/cline/common"
import {
	MarketplaceEntriesRequest,
	type MarketplaceEntry,
	type MarketplaceEntryDetail,
	MarketplaceEntryDetailRequest,
	MarketplaceEntryExecuteInputRow,
	MarketplaceEntryExecuteRequest,
	type MarketplaceEntryExecuteResult,
	MarketplaceEntryQuoteRequest,
	type MarketplaceEntryQuoteResult,
	MarketplaceEntryRequest,
	MarketplaceRunResultArtifactsRequest,
	MarketplaceSaveRunResultRequest,
} from "@shared/proto/cline/marketplace"
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"
import { CheckIcon, DownloadIcon, LoaderCircleIcon, PlayIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { TabContent, TabList, TabTrigger } from "@/components/common/Tab"
import { MarketplaceStyles, Section } from "@/components/marketplace/MarketplaceView"
import { useSignIn as useShengSuanYunSignIn } from "@/context/ShengSuanYunAuthContext"
import { AccountServiceClient, MarketplaceServiceClient } from "@/services/grpc-client"

type BatchTab = "catalog" | "fire" | "result"

type InputField = {
	key?: string
	label?: string
	order?: number
	presentation?: { hint?: string; widget?: string }
	required?: boolean
	source_kind?: string
	value_type?: string
	default_value?: unknown
	enum_values?: string[]
}

type InputSchema = {
	fields?: InputField[]
	input_summary?: string
	instructions?: string[] | string
	sample_rows?: unknown[]
	schema_version?: string
}

type RunArtifact = {
	artifactId?: string
	accessUrl?: string
	inlineText?: string
	mimeType?: string
	portName?: string
	[key: string]: unknown
}

const TABS: Array<{ type: BatchTab; label: string }> = [
	{ type: "catalog", label: "LoomLoom Skills" },
	{ type: "fire", label: "执行" },
	{ type: "result", label: "结果" },
]

const LOOMLOOM_ORIGIN = "https://loomloom.shengsuanyun.com"

function entryKey(entry: MarketplaceEntry): string {
	return `${entry.type}:${entry.id}`
}

function isLoomLoomSkill(entry: MarketplaceEntry): boolean {
	return entry.type === "skill" && (entry.tags.includes("胜算云") || entry.sourceUrl?.startsWith(LOOMLOOM_ORIGIN) === true)
}

function parseSchema(inputSchemaSnapshot: string | undefined): InputSchema {
	if (!inputSchemaSnapshot) return {}
	try {
		const parsed = JSON.parse(inputSchemaSnapshot)
		return parsed && typeof parsed === "object" ? (parsed as InputSchema) : {}
	} catch {
		return {}
	}
}

function defaultValues(inputSchemaSnapshot: string | undefined): Record<string, string> {
	const schema = parseSchema(inputSchemaSnapshot)
	const result: Record<string, string> = {}
	for (const field of schema.fields ?? []) {
		if (typeof field.key === "string" && field.default_value !== undefined && field.default_value !== null) {
			result[field.key] = String(field.default_value)
		}
	}
	return result
}

function sortedFields(schema: InputSchema): InputField[] {
	return [...(schema.fields ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
}

function instructionsOf(schema: InputSchema): string[] {
	if (Array.isArray(schema.instructions)) return schema.instructions.filter((item): item is string => typeof item === "string")
	if (typeof schema.instructions === "string" && schema.instructions.trim()) return [schema.instructions]
	return []
}

function buildSavedResult(executeResult: MarketplaceEntryExecuteResult, rows: RunArtifact[]): { title: string; content: string } {
	const title = executeResult.skillName?.trim() || "LoomLoom 批量执行结果"
	const lines: string[] = []
	if (executeResult.runId) lines.push(`ID: ${executeResult.runId}`)
	if (executeResult.finalBuyerPayable) lines.push(`实际应付金额: ${executeResult.finalBuyerPayable}`)
	for (const row of rows) {
		if (row.inlineText?.trim()) lines.push(row.inlineText)
		// A row can carry both a truncated inline preview and a link to the full
		// artifact (the live result page shows both). Preserve the link instead of
		// dropping everything past the preview so the saved result stays complete.
		if (row.accessUrl) {
			const kind = row.mimeType?.startsWith("text") ? "原文" : "下载"
			lines.push(`${kind}${row.portName ? `（${row.portName}）` : ""}: ${row.accessUrl}`)
		}
	}
	return { title, content: lines.join("\n") }
}

type SkillTask = {
	id: string
	values: Record<string, string>
}

let taskSequence = 0
function createTask(values: Record<string, string>): SkillTask {
	taskSequence += 1
	return { id: `task-${taskSequence}`, values }
}

function validateTask(values: Record<string, string>, fields: InputField[]): Record<string, string> {
	const errors: Record<string, string> = {}
	for (const field of fields) {
		if (!field.key) continue
		const raw = values[field.key] ?? ""
		const trimmed = raw.trim()
		const label = field.label || field.key
		if (field.required && trimmed === "") {
			errors[field.key] = `${label} 为必填项。`
			continue
		}
		if (trimmed === "") continue
		if (field.value_type === "integer" && !Number.isInteger(Number(trimmed))) {
			errors[field.key] = `${label} 需要是整数。`
			continue
		}
		if (field.required && field.value_type !== "integer" && [...trimmed].length < 2) {
			errors[field.key] = `${label} 至少需要 2 个字符。`
			continue
		}
		if (field.enum_values && field.enum_values.length > 0 && !field.enum_values.includes(trimmed)) {
			errors[field.key] = `${label} 需要是以下选项之一：${field.enum_values.join("、")}。`
		}
	}
	return errors
}

function collectParams(values: Record<string, string>, fields: InputField[]): Record<string, string> {
	const payload: Record<string, string> = {}
	for (const field of fields) {
		if (!field.key) continue
		const value = values[field.key]
		if (value !== undefined && value !== "") payload[field.key] = value
	}
	return payload
}

const BatchStyles = () => (
	<style>{`
		.batch-input-error {
			border-color: var(--vscode-errorForeground, #f14c4c) !important;
		}

		.batch-input-error:focus {
			outline-color: var(--vscode-errorForeground, #f14c4c) !important;
		}

		.batch-field-error {
			color: var(--vscode-errorForeground, #f14c4c);
			font-size: calc(var(--vscode-font-size) * 0.82);
			line-height: 1.3;
			overflow-wrap: anywhere;
			word-break: break-word;
		}

		.batch-task-card {
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
			padding: 8px 10px;
			margin-bottom: 8px;
			background: var(--vscode-sideBar-background);
		}

		.batch-task-card-header {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			margin-bottom: 6px;
		}

		.batch-task-card-title {
			font-weight: 600;
			color: var(--vscode-foreground);
		}

		.batch-task-card-body {
			display: grid;
			gap: 3px;
		}

		.batch-task-item {
			display: flex;
			gap: 6px;
			font-size: var(--vscode-font-size);
			line-height: 1.4;
		}

		.batch-task-item-label {
			color: var(--vscode-descriptionForeground);
			flex: 0 0 auto;
		}

		.batch-task-item-value {
			color: var(--vscode-foreground);
			overflow-wrap: anywhere;
			word-break: break-word;
			min-width: 0;
		}

		.marketplace-detail-list {
			list-style: none;
			margin: 0;
			padding: 0;
			display: grid;
			gap: 6px;
		}

		.marketplace-detail-list li {
			display: flex;
			justify-content: space-between;
			gap: 12px;
			padding: 6px 0;
			border-bottom: 1px solid var(--vscode-panel-border);
			font-size: var(--vscode-font-size);
			line-height: 1.4;
		}

		.marketplace-detail-label {
			color: var(--vscode-descriptionForeground);
			flex: 0 0 auto;
		}

		.marketplace-detail-value {
			color: var(--vscode-foreground);
			overflow-wrap: anywhere;
			word-break: break-word;
			text-align: right;
			min-width: 0;
		}
	`}</style>
)

const SkillCatalogRow = ({
	entry,
	installed,
	installing,
	uninstalling,
	onInstall,
	onRun,
	onUninstall,
}: {
	entry: MarketplaceEntry
	installed: boolean
	installing: boolean
	uninstalling: boolean
	onInstall: (entry: MarketplaceEntry) => void
	onRun: (entry: MarketplaceEntry) => void
	onUninstall: (entry: MarketplaceEntry) => void
}) => {
	const name = entry.name || entry.id
	return (
		<div className="marketplace-row">
			<div className="marketplace-row-main">
				<div className="marketplace-row-title">
					<span className="marketplace-row-name">{name}</span>
				</div>
				{(entry.description || entry.tagline) && (
					<div className="marketplace-row-description">{entry.description || entry.tagline}</div>
				)}
				<div className="marketplace-row-meta">
					{entry.fee && <span className="text-green-600">¥{Number(entry.fee).toFixed(2)}</span>}
					{entry.author && <span className="marketplace-pill">{entry.author}</span>}
					{entry.tags.map((tag) => (
						<span className="marketplace-pill" key={tag}>
							{tag}
						</span>
					))}
				</div>
			</div>
			<div className="marketplace-action">
				{installed ? (
					<>
						<button
							className="marketplace-text-button marketplace-text-button-primary"
							onClick={() => onRun(entry)}
							type="button">
							<PlayIcon aria-hidden />
							运行
						</button>
						<button
							aria-label={`卸载 ${name}`}
							className="marketplace-icon-button marketplace-icon-button-danger"
							disabled={uninstalling}
							onClick={() => onUninstall(entry)}
							title={`卸载 ${name}`}
							type="button">
							{uninstalling ? (
								<LoaderCircleIcon aria-hidden className="marketplace-icon-spin" />
							) : (
								<Trash2Icon aria-hidden />
							)}
						</button>
					</>
				) : (
					<button
						className="marketplace-text-button"
						disabled={installing}
						onClick={() => onInstall(entry)}
						title={`安装 ${name}`}
						type="button">
						{installing ? (
							<LoaderCircleIcon aria-hidden className="marketplace-icon-spin" />
						) : (
							<DownloadIcon aria-hidden />
						)}
						安装
					</button>
				)}
			</div>
		</div>
	)
}

const FieldControl = ({
	field,
	value,
	error,
	onChange,
}: {
	field: InputField
	value: string
	error?: string
	onChange: (value: string) => void
}) => {
	const key = field.key ?? ""
	const widget = field.presentation?.widget
	const hint = field.presentation?.hint
	const label = field.label || key
	const inputId = `batch-field-${key}`
	const inputClass = `marketplace-field-input${error ? " batch-input-error" : ""}`
	const enumValues = field.enum_values ?? []
	return (
		<div className="marketplace-field">
			<label className="marketplace-field-label" htmlFor={inputId}>
				{label}
				{field.required && <span className="marketplace-required">*</span>}
			</label>
			{enumValues.length > 0 ? (
				<select
					aria-invalid={error ? true : undefined}
					className={inputClass}
					id={inputId}
					onChange={(event) => onChange(event.target.value)}
					value={value}>
					<option disabled={field.required} value="">
						{field.required ? "请选择…" : "（留空使用默认值）"}
					</option>
					{enumValues.map((option) => (
						<option key={option} value={option}>
							{option}
						</option>
					))}
				</select>
			) : widget === "textarea" ? (
				<textarea
					aria-invalid={error ? true : undefined}
					className={inputClass}
					id={inputId}
					onChange={(event) => onChange(event.target.value)}
					rows={3}
					value={value}
				/>
			) : (
				<input
					aria-invalid={error ? true : undefined}
					className={inputClass}
					id={inputId}
					inputMode={field.value_type === "integer" ? "numeric" : undefined}
					onChange={(event) => onChange(event.target.value)}
					type="text"
					value={value}
				/>
			)}
			{hint && <div className="marketplace-field-hint">{hint}</div>}
			{error && <div className="batch-field-error">{error}</div>}
		</div>
	)
}

export const BatchArea = ({
	start = "catalog",
	savedResult = null,
}: {
	start?: BatchTab
	savedResult?: { title: string; content: string } | null
}) => {
	const [tab, setTab] = useState<BatchTab>(start)
	const [catalogEntries, setCatalogEntries] = useState<MarketplaceEntry[]>([])
	const [installedKeys, setInstalledKeys] = useState<Set<string>>(new Set())
	const [installingId, setInstallingId] = useState<string | null>(null)
	const [uninstallingId, setUninstallingId] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const [activeEntry, setActiveEntry] = useState<MarketplaceEntry | null>(null)
	const [detail, setDetail] = useState<MarketplaceEntryDetail | null>(null)
	const [detailLoading, setDetailLoading] = useState(false)
	const [detailError, setDetailError] = useState<string | null>(null)
	const [tasks, setTasks] = useState<SkillTask[]>([])
	const [errors, setErrors] = useState<Record<string, string>>({})
	const [quoting, setQuoting] = useState(false)
	const [quote, setQuote] = useState<MarketplaceEntryQuoteResult | null>(null)
	const [executing, setExecuting] = useState(false)
	const [executeError, setExecuteError] = useState<string | null>(null)
	const [executeResult, setExecuteResult] = useState<MarketplaceEntryExecuteResult | null>(null)
	const [runRows, setRunRows] = useState<RunArtifact[] | null>(null)
	const [polling, setPolling] = useState(false)
	const lastSavedRunIdRef = useRef<string | null>(null)
	const { isLoginLoading, handleSignIn } = useShengSuanYunSignIn()

	const refresh = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const catalog = await MarketplaceServiceClient.getMarketplaceCatalog(EmptyRequest.create({}))
			const entries = catalog.entries.filter(isLoomLoomSkill)
			const installed = await MarketplaceServiceClient.listMarketplaceInstalledEntries(
				MarketplaceEntriesRequest.create({ entries }),
			)
			const installedKeySet = new Set(installed.installedKeys)
			const sortedEntries = [...entries].sort((a, b) => {
				const aInstalled = installedKeySet.has(entryKey(a)) ? 1 : 0
				const bInstalled = installedKeySet.has(entryKey(b)) ? 1 : 0
				return bInstalled - aInstalled
			})
			setCatalogEntries(sortedEntries)
			setInstalledKeys(installedKeySet)
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		refresh()

		// ShengSuanYun login completes asynchronously via the local OAuth callback and
		// broadcasts through `subscribeToAuthStatusUpdate`. Re-fetch the catalog on any
		// such event so LoomLoom Skills appear without requiring a remount.
		const cancelSubscription = AccountServiceClient.subscribeToAuthStatusUpdate(EmptyRequest.create({}), {
			onResponse: () => {
				refresh()
			},
			onError: (error: Error) => {
				console.error("Failed to subscribe to auth status update:", error)
			},
			onComplete: () => {},
		})

		return () => {
			cancelSubscription()
		}
	}, [refresh])

	useEffect(() => {
		if (!activeEntry) return
		let cancelled = false
		setDetailLoading(true)
		setDetailError(null)
		MarketplaceServiceClient.getMarketplaceEntryDetail(MarketplaceEntryDetailRequest.create({ id: activeEntry.id }))
			.then((result) => {
				if (cancelled) return
				setDetail(result)
				setTasks([createTask(defaultValues(result.inputSchemaSnapshot))])
				setErrors({})
			})
			.catch((err) => {
				if (!cancelled) setDetailError(err instanceof Error ? err.message : String(err))
			})
			.finally(() => {
				if (!cancelled) setDetailLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [activeEntry])

	const schema = useMemo(() => parseSchema(detail?.inputSchemaSnapshot), [detail])
	const fields = useMemo(() => sortedFields(schema), [schema])
	const instructions = useMemo(() => instructionsOf(schema), [schema])

	const handleInstall = useCallback(
		async (entry: MarketplaceEntry) => {
			setInstallingId(entryKey(entry))
			setError(null)
			try {
				await MarketplaceServiceClient.installMarketplaceEntry(MarketplaceEntryRequest.create({ entry }))
				await refresh()
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
			} finally {
				setInstallingId(null)
			}
		},
		[refresh],
	)

	const handleUninstall = useCallback(
		async (entry: MarketplaceEntry) => {
			setUninstallingId(entryKey(entry))
			setError(null)
			try {
				await MarketplaceServiceClient.uninstallMarketplaceEntry(MarketplaceEntryRequest.create({ entry }))
				await refresh()
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
			} finally {
				setUninstallingId(null)
			}
		},
		[refresh],
	)

	const handleRun = useCallback((entry: MarketplaceEntry) => {
		setActiveEntry(entry)
		setDetail(null)
		setDetailError(null)
		setTasks([])
		setErrors({})
		setQuoting(false)
		setQuote(null)
		setExecuting(false)
		setExecuteError(null)
		setExecuteResult(null)
		setRunRows(null)
		setPolling(false)
		setTab("fire")
	}, [])

	const setFieldValue = useCallback((key: string, value: string) => {
		setTasks((prev) => {
			const next = prev.slice()
			const last = next[next.length - 1]
			if (!last) return next
			next[next.length - 1] = { ...last, values: { ...last.values, [key]: value } }
			return next
		})
		setErrors((prev) => {
			if (!(key in prev)) return prev
			const next = { ...prev }
			delete next[key]
			return next
		})
	}, [])

	const handleAddTask = useCallback(() => {
		const current = tasks[tasks.length - 1]
		if (!current) return
		const nextErrors = validateTask(current.values, fields)
		setErrors(nextErrors)
		if (Object.keys(nextErrors).length > 0) return
		setTasks((prev) => [...prev, createTask({})])
	}, [tasks, fields])

	const handleExecute = useCallback(async () => {
		if (!activeEntry) return
		const current = tasks[tasks.length - 1]
		if (!current) return
		const nextErrors = validateTask(current.values, fields)
		setErrors(nextErrors)
		if (Object.keys(nextErrors).length > 0) return
		const inputRows = tasks.map((task) => collectParams(task.values, fields))
		setQuote(null)
		setExecuteError(null)
		setExecuteResult(null)
		setRunRows(null)
		setPolling(false)
		setQuoting(true)
		setTab("result")
		try {
			const result = await MarketplaceServiceClient.quoteMarketplaceEntry(
				MarketplaceEntryQuoteRequest.create({
					id: activeEntry.id,
					inputRows: inputRows.map((row) => MarketplaceEntryExecuteInputRow.create({ fields: row })),
				}),
			)
			setQuote(result)
		} catch (err) {
			setExecuteError(err instanceof Error ? err.message : String(err))
		} finally {
			setQuoting(false)
		}
	}, [activeEntry, tasks, fields])

	const handleApprove = useCallback(async () => {
		if (!activeEntry) return
		const inputRows = tasks.map((task) => collectParams(task.values, fields))
		setExecuting(true)
		setExecuteError(null)
		setExecuteResult(null)
		setRunRows(null)
		setPolling(false)
		try {
			const result = await MarketplaceServiceClient.executeMarketplaceEntry(
				MarketplaceEntryExecuteRequest.create({
					id: activeEntry.id,
					inputRows: inputRows.map((row) => MarketplaceEntryExecuteInputRow.create({ fields: row })),
					confirm: true,
				}),
			)
			setExecuteResult(result)
		} catch (err) {
			setExecuteError(err instanceof Error ? err.message : String(err))
		} finally {
			setExecuting(false)
		}
	}, [activeEntry, tasks, fields])

	const handleCancelQuote = useCallback(() => {
		setQuote(null)
		setExecuteError(null)
		setExecuteResult(null)
		setRunRows(null)
		setPolling(false)
		setTab("fire")
	}, [])

	useEffect(() => {
		const runId = executeResult?.runId
		if (!runId) return
		let cancelled = false
		let timer: ReturnType<typeof setTimeout> | null = null
		let attempts = 0
		const MAX_ATTEMPTS = 160
		const poll = async () => {
			try {
				const result = await MarketplaceServiceClient.getMarketplaceRunResultArtifacts(
					MarketplaceRunResultArtifactsRequest.create({ runId }),
				)
				if (cancelled) return
				const rows = result.output ? (JSON.parse(result.output) as unknown) : []
				const artifactRows = Array.isArray(rows) ? (rows as RunArtifact[]) : []
				setRunRows(artifactRows)
				if (result.done) {
					setPolling(false)
					if (executeResult && lastSavedRunIdRef.current !== runId) {
						lastSavedRunIdRef.current = runId
						const { title, content } = buildSavedResult(executeResult, artifactRows)
						MarketplaceServiceClient.saveMarketplaceRunResult(
							MarketplaceSaveRunResultRequest.create({ title, content }),
						).catch((err) => {
							console.error("保存批量执行结果失败:", err)
						})
					}
					return
				}
				attempts += 1
				if (attempts >= MAX_ATTEMPTS) {
					setPolling(false)
					return
				}
				timer = setTimeout(poll, 3000)
			} catch (err) {
				if (cancelled) return
				setPolling(false)
				setExecuteError((prev) => prev ?? (err instanceof Error ? err.message : String(err)))
			}
		}
		setPolling(true)
		poll()
		return () => {
			cancelled = true
			if (timer) clearTimeout(timer)
		}
	}, [executeResult])

	const activeName = detail?.name || activeEntry?.name || activeEntry?.id
	const openTask = tasks[tasks.length - 1]

	return (
		<div className="flex-1 min-h-0 flex flex-col relative">
			<MarketplaceStyles />
			<BatchStyles />
			<div className="marketplace-shell">
				<TabList className="marketplace-nav" onValueChange={(value) => setTab(value as BatchTab)} value={tab}>
					{TABS.map((item) => (
						<TabTrigger className="marketplace-tab" key={item.type} value={item.type}>
							<span className="marketplace-tab-label">{item.label}</span>
						</TabTrigger>
					))}
				</TabList>

				<TabContent className="marketplace-content">
					<div className="marketplace-inner">
						{tab === "catalog" && (
							<>
								{error && <div className="marketplace-error">{error}</div>}
								{loading ? (
									<div className="marketplace-loading">
										<VSCodeProgressRing />
										<span>正在加载 Skills</span>
									</div>
								) : (
									<Section
										count={catalogEntries.length}
										empty={
											<div className="flex flex-col items-center gap-2">
												<span className="my-3">登录胜算云，运行 LoomLoom Skills</span>
												<VSCodeButton
													appearance="primary"
													disabled={isLoginLoading}
													onClick={handleSignIn}>
													登录胜算云
													{isLoginLoading && (
														<span className="ml-1 animate-spin">
															<span className="codicon codicon-refresh" />
														</span>
													)}
												</VSCodeButton>
											</div>
										}
										showHeader={false}
										title="Skills">
										{catalogEntries.map((entry) => (
											<SkillCatalogRow
												entry={entry}
												installed={installedKeys.has(entryKey(entry))}
												installing={installingId === entryKey(entry)}
												key={entryKey(entry)}
												onInstall={handleInstall}
												onRun={handleRun}
												onUninstall={handleUninstall}
												uninstalling={uninstallingId === entryKey(entry)}
											/>
										))}
									</Section>
								)}
							</>
						)}

						{tab === "fire" && (
							<>
								{!activeEntry ? (
									<div className="marketplace-empty">请先在「Skill 目录」中点击「运行」选择一个 Skill。</div>
								) : detailLoading ? (
									<div className="marketplace-loading">
										<VSCodeProgressRing />
										<span>正在加载 Skill 详情…</span>
									</div>
								) : detailError ? (
									<div className="marketplace-error">{detailError}</div>
								) : (
									<div className="marketplace-form">
										<div className="marketplace-section-header">
											<h3 className="marketplace-section-title">{activeName}</h3>
										</div>
										{schema.input_summary && (
											<div className="marketplace-form-summary">{schema.input_summary}</div>
										)}
										{instructions.length > 0 && (
											<ul className="marketplace-form-instructions">
												{instructions.map((instruction, index) => (
													<li key={`${index}-${instruction}`}>{instruction}</li>
												))}
											</ul>
										)}
										{tasks.slice(0, -1).map((task, index) => (
											<div className="batch-task-card" key={task.id}>
												<div className="batch-task-card-header">
													<span className="batch-task-card-title">任务 {index + 1}</span>
													<span className="marketplace-pill">已填写</span>
												</div>
												<div className="batch-task-card-body">
													{fields.map((field) => {
														const value = task.values[field.key ?? ""]
														if (value === undefined || value === "") return null
														return (
															<div className="batch-task-item" key={field.key}>
																<span className="batch-task-item-label">
																	{field.label || field.key}:
																</span>
																<span className="batch-task-item-value">{value}</span>
															</div>
														)
													})}
												</div>
											</div>
										))}
										{openTask &&
											fields.map((field) => (
												<FieldControl
													error={errors[field.key ?? ""]}
													field={field}
													key={field.key ?? field.label ?? field.order}
													onChange={(value) => setFieldValue(field.key ?? "", value)}
													value={openTask.values[field.key ?? ""] ?? ""}
												/>
											))}
										<div className="marketplace-form-actions">
											<button
												className="marketplace-text-button marketplace-text-button-primary"
												onClick={handleExecute}
												type="button">
												<PlayIcon aria-hidden />
												执行
											</button>
											<button className="marketplace-text-button" onClick={handleAddTask} type="button">
												<PlusIcon aria-hidden />
												增加任务
											</button>
										</div>
									</div>
								)}
							</>
						)}

						{tab === "result" && (
							<>
								{!savedResult && !quote && !executeResult && !executeError && !executing && !quoting && (
									<div className="marketplace-empty">尚未执行任何 Skill。</div>
								)}
								{savedResult && !quote && !executeResult && !executeError && !executing && !quoting && (
									<>
										<div className="marketplace-section-header">
											<h3 className="marketplace-section-title">{savedResult.title}</h3>
										</div>
										<div className="marketplace-form">
											{savedResult.content && (
												<pre className="marketplace-result-pre">{savedResult.content}</pre>
											)}
										</div>
									</>
								)}
								{quoting && (
									<div className="marketplace-loading">
										<VSCodeProgressRing />
										<span>正在预估任务执行价格…</span>
									</div>
								)}
								{quote && (
									<>
										<div className="marketplace-section-header">
											<h3 className="marketplace-section-title">任务执行报价</h3>
										</div>
										<div className="marketplace-form">
											<div className="marketplace-form-summary">
												{quote.message}请确认后继续执行，实际费用以执行结果为准。
											</div>
											<ul className="marketplace-detail-list">
												{quote.taskCount > 0 && (
													<li>
														<span className="marketplace-detail-label">任务数</span>
														<span className="marketplace-detail-value">{quote.taskCount}</span>
													</li>
												)}
												{quote.estimatedBuyerPayable && (
													<li>
														<span className="marketplace-detail-label">预估应付金额</span>
														<span className="marketplace-detail-value">
															{quote.estimatedBuyerPayable}
														</span>
													</li>
												)}
												{quote.estimatedExecutionCost && (
													<li>
														<span className="marketplace-detail-label">预估执行成本</span>
														<span className="marketplace-detail-value">
															{quote.estimatedExecutionCost}
														</span>
													</li>
												)}
												{quote.taskFixedFee && (
													<li>
														<span className="marketplace-detail-label">任务固定费用</span>
														<span className="marketplace-detail-value">{quote.taskFixedFee}</span>
													</li>
												)}
											</ul>
											{/* {quote.output && <pre className="marketplace-result-pre">{quote.output}</pre>} */}
											<div className="marketplace-form-actions mb-3">
												<button
													className="marketplace-text-button marketplace-text-button-primary"
													disabled={executing || !!executeResult}
													onClick={handleApprove}
													type="button">
													<CheckIcon aria-hidden />
													批准并执行
												</button>
												<button
													className="marketplace-text-button"
													disabled={executing || !!executeResult}
													onClick={handleCancelQuote}
													type="button">
													<XIcon aria-hidden />
													取消
												</button>
											</div>
										</div>
									</>
								)}
								{executing && (
									<div className="marketplace-loading">
										<VSCodeProgressRing />
										<span>正在执行 Skill…</span>
									</div>
								)}
								{executeError && <div className="marketplace-error">{executeError}</div>}
								{executeResult && (
									<>
										<div className="marketplace-section-header">
											<h3 className="marketplace-section-title">执行提交结果</h3>
										</div>
										<div className="marketplace-form">
											<ul className="marketplace-detail-list">
												{/* {executeResult.transactionStatus && (
													<li>
														<span className="marketplace-detail-label">交易状态</span>
														<span className="marketplace-detail-value">
															{executeResult.transactionStatus}
														</span>
													</li>
												)} */}
												{executeResult.runId && (
													<li>
														<span className="marketplace-detail-label">ID</span>
														<span className="marketplace-detail-value">{executeResult.runId}</span>
													</li>
												)}
												{executeResult.finalBuyerPayable && (
													<li>
														<span className="marketplace-detail-label">实际应付金额</span>
														<span className="marketplace-detail-value">
															{executeResult.finalBuyerPayable}
														</span>
													</li>
												)}
											</ul>
											{polling && (
												<div className="marketplace-loading">
													<VSCodeProgressRing />
													<span>正在轮询执行结果…</span>
												</div>
											)}
											{Array.isArray(runRows) && runRows.length > 0 && (
												<div className="flex flex-col gap-3">
													{runRows.map((it) => (
														<div
															className="flex flex-col gap-1"
															key={it.artifactId ?? it.accessUrl ?? String(it.sourceRowIndex)}>
															{it.inlineText ? (
																<pre className="marketplace-result-pre">{it.inlineText}</pre>
															) : null}
															{it.accessUrl ? (
																<a href={it.accessUrl} rel="noreferrer" target="_blank">
																	{it.inlineText
																		? it.mimeType?.startsWith("text")
																			? "查看原文"
																			: "下载文件"
																		: it.accessUrl}
																	{it.portName ? `（${it.portName}）` : ""}
																</a>
															) : null}
														</div>
													))}
												</div>
											)}
											{/* {executeResult.output && (
												<pre className="marketplace-result-pre">{executeResult.output}</pre>
											)} */}
										</div>
									</>
								)}
							</>
						)}
					</div>
				</TabContent>
			</div>
		</div>
	)
}

export default BatchArea
