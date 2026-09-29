import {
	type BatchCommand,
	type BatchField,
	type BatchSession,
	type BatchTableSnapshot,
	type BatchValue,
	type BatchWorksheetView,
	effectiveTaskCount,
} from "@shared/loomloom"
import { getBatchFileInputMode } from "@shared/loomloom-files"
import {
	buildSheet,
	columnLetter,
	listSheets,
	parseRange,
	parseTsv,
	selectionAddress,
	sheetValue,
	statusLabel,
} from "@shared/loomloom-sheet"
import { StringRequest } from "@shared/proto/cline/common"
import {
	type CSSProperties,
	Fragment,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react"
import { getWebviewState, PLATFORM_CONFIG, setWebviewState } from "@/config/platform.config"
import { LoomLoomServiceClient } from "@/services/grpc-client"
import { BatchFieldEditor } from "./BatchFieldEditor"
import { BatchRunControls } from "./BatchRunControls"
import { sendBatch } from "./batch-api"
import { batchOutputRoot } from "./batch-output-location"
import { type CreatorDraft, CreatorWorkbench, createCreatorDraft } from "./CreatorWorkbench"
import "./batch.css"
import "./batch-worksheet.css"

const request = (value: unknown) => StringRequest.create({ value: JSON.stringify(value) })
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const time = (value?: number) => (value ? new Date(value).toLocaleString() : "—")
const GRID_ROW_HEIGHT = 29
const WRAPPED_ROW_HEIGHT = 116
const GRID_HEADER_HEIGHT = 55
const GRID_OVERSCAN = 6
type WorksheetEditor = {
	address: string
	sheet: string
	revision: number
	value: BatchValue
	row: number
	col: number
}
type WorksheetInlineEdit = Omit<WorksheetEditor, "value"> & { value: string; original: string }
type MediaPreview = {
	key: string
	status: "loading" | "ready" | "error"
	uri?: string
	mimeType?: string
	relativePath?: string
	error?: string
}
const MEDIA_PREVIEW_MIMES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/avif",
	"video/mp4",
	"video/webm",
])
type PendingView = { next: BatchWorksheetView; patch: Partial<BatchWorksheetView>; requestId: number }
function isInlineTextField(field?: BatchField): field is BatchField {
	return (
		!!field &&
		field.value_type !== "asset_ref" &&
		field.value_type !== "boolean" &&
		!field.enum_values?.length &&
		!field.model_override &&
		!/model|模型/i.test(field.key + field.label)
	)
}
type WorksheetDraft = {
	version: 1
	taskId: string
	formula?: { value: string; revision: number; target: { sheet: string; address: string } }
	editor?: WorksheetEditor
	inline?: WorksheetInlineEdit
	/** In-flight writes are restored as uncertain drafts, never replayed automatically. */
	pendingInline?: WorksheetInlineEdit[]
	failedInline?: WorksheetInlineEdit[]
	surface?: "sheet" | "creator"
	creator?: CreatorDraft
	creatorLocalAt?: number
}
function validInlineEdit(value: unknown): value is WorksheetInlineEdit {
	if (!value || typeof value !== "object") return false
	const edit = value as Partial<WorksheetInlineEdit>
	return (
		typeof edit.address === "string" &&
		typeof edit.sheet === "string" &&
		typeof edit.value === "string" &&
		typeof edit.original === "string" &&
		Number.isSafeInteger(edit.revision) &&
		Number.isSafeInteger(edit.row) &&
		Number.isSafeInteger(edit.col)
	)
}
function validCreatorDraft(value: unknown): CreatorDraft | null {
	if (!value || typeof value !== "object") return null
	const draft = value as Partial<CreatorDraft>
	return draft.version === 1 && typeof draft.name === "string" && typeof draft.advancedJson === "string"
		? { ...createCreatorDraft(), ...draft }
		: null
}
type RowDeletion = {
	revision: number
	range: string
	count: number
	top: number
	filled: number
	files: number
}
function readDraft(taskId: string): WorksheetDraft | null {
	const stored = getWebviewState() as Partial<WorksheetDraft> | null
	if (!stored || stored.version !== 1 || stored.taskId !== taskId) return null
	const formula = stored.formula
	const editor = stored.editor
	return {
		version: 1,
		taskId,
		surface: stored.surface === "creator" ? "creator" : "sheet",
		creator: validCreatorDraft(stored.creator) ?? undefined,
		creatorLocalAt: Number.isSafeInteger(stored.creatorLocalAt) ? stored.creatorLocalAt : undefined,
		formula:
			formula &&
			typeof formula.value === "string" &&
			Number.isSafeInteger(formula.revision) &&
			typeof formula.target?.sheet === "string" &&
			typeof formula.target.address === "string"
				? formula
				: undefined,
		editor:
			editor &&
			typeof editor.address === "string" &&
			typeof editor.sheet === "string" &&
			Number.isSafeInteger(editor.revision) &&
			Number.isSafeInteger(editor.row) &&
			Number.isSafeInteger(editor.col)
				? editor
				: undefined,
		inline: validInlineEdit(stored.inline) ? stored.inline : undefined,
		pendingInline: Array.isArray(stored.pendingInline) ? stored.pendingInline.filter(validInlineEdit) : undefined,
		failedInline: Array.isArray(stored.failedInline) ? stored.failedInline.filter(validInlineEdit) : undefined,
	}
}

/** A view onto the existing task, with no chat provider, model or independent draft store. */
export function BatchWorksheet({ taskId, panelId }: { taskId: string; panelId?: string }) {
	const restoredDraft = useMemo(() => readDraft(taskId), [taskId])
	const [snapshot, setSnapshot] = useState<BatchTableSnapshot | null>(null)
	const [connection, setConnection] = useState("连接中"),
		[reconnect, setReconnect] = useState(0)
	const [error, setError] = useState(""),
		[busy, setBusy] = useState(false)
	const [localView, setLocalView] = useState<BatchWorksheetView | null>(null)
	const [hostView, setHostView] = useState<BatchWorksheetView | null>(null)
	const [formula, setFormula] = useState(restoredDraft?.formula?.value ?? ""),
		[formulaRevision, setFormulaRevision] = useState(restoredDraft?.formula?.revision ?? 0),
		[formulaDirty, setFormulaDirty] = useState(!!restoredDraft?.formula)
	const [formulaTarget, setFormulaTarget] = useState(restoredDraft?.formula?.target ?? { sheet: "current", address: "C2" })
	const [addressInput, setAddressInput] = useState("C2"),
		[search, setSearch] = useState("")
	const [viewport, setViewport] = useState({ top: 0, height: 600 })
	const [editor, setEditor] = useState<WorksheetEditor | null>(restoredDraft?.editor ?? null)
	const [mediaPreview, setMediaPreview] = useState<MediaPreview | null>(null)
	const [mediaLoaded, setMediaLoaded] = useState(false)
	const [previewRetry, setPreviewRetry] = useState(0)
	const [inlineEdit, setInlineEdit] = useState<WorksheetInlineEdit | null>(restoredDraft?.inline ?? null)
	const [pendingInlineEdits, setPendingInlineEdits] = useState<Record<string, WorksheetInlineEdit>>({})
	const [failedInlineEdits, setFailedInlineEdits] = useState<Record<string, WorksheetInlineEdit>>(() =>
		Object.fromEntries(
			[...(restoredDraft?.failedInline ?? []), ...(restoredDraft?.pendingInline ?? [])].map((edit) => [edit.address, edit]),
		),
	)
	const [pendingInlineCount, setPendingInlineCount] = useState(0)
	const [editLeaseError, setEditLeaseError] = useState("")
	const [editLeaseRetry, setEditLeaseRetry] = useState(0)
	const [creatorMode, setCreatorMode] = useState(restoredDraft?.surface === "creator")
	const [creatorDraft, setCreatorDraft] = useState<CreatorDraft>(restoredDraft?.creator ?? createCreatorDraft())
	const [creatorLoaded, setCreatorLoaded] = useState(!!restoredDraft?.creator)
	const [creatorHostReady, setCreatorHostReady] = useState(false)
	const [creatorConflict, setCreatorConflict] = useState<{ draft: CreatorDraft; updatedAt: number } | null>(null)
	const creatorTouched = useRef(false)
	const creatorDraftRef = useRef(creatorDraft)
	const creatorLoadedRef = useRef(creatorLoaded)
	const creatorHostReadyRef = useRef(creatorHostReady)
	const creatorLocalAt = useRef(restoredDraft?.creatorLocalAt ?? 0)
	const creatorHostUpdatedAt = useRef<number | null>(null)
	const creatorConflictRef = useRef(false)
	const creatorSaveQueue = useRef(Promise.resolve<unknown>(undefined))
	const creatorQueuedSaves = useRef(0)
	const creatorSaveGeneration = useRef(0)
	const lastQueuedCreator = useRef<CreatorDraft | null>(null)
	creatorDraftRef.current = creatorDraft
	creatorLoadedRef.current = creatorLoaded
	creatorHostReadyRef.current = creatorHostReady
	const [rowsToAdd, setRowsToAdd] = useState(1)
	const [pendingDelete, setPendingDelete] = useState<RowDeletion | null>(null)
	const gridRef = useRef<HTMLDivElement>(null),
		dialogRef = useRef<HTMLDivElement>(null),
		inlineInputRef = useRef<HTMLTextAreaElement>(null),
		keyboardCaptureRef = useRef<HTMLTextAreaElement>(null)
	const inlineClosing = useRef(false)
	const composing = useRef(false)
	const justFinishedComposition = useRef(false)
	const compositionTimer = useRef<number | undefined>(undefined)
	const pendingInlineCountRef = useRef(0)
	const inlineWriteRevision = useRef<number | null>(null)
	const inlineWriteFailed = useRef(false)
	const lastOwnRevision = useRef(0)
	const editLeaseQueue = useRef(Promise.resolve())
	const editLeaseAcknowledged = useRef(false)
	const editLeaseDesired = useRef(false)
	const editLeaseActiveRef = useRef(false)
	const editLeaseRetryTimer = useRef<number | undefined>(undefined)
	const editLeaseReleaseTimer = useRef<number | undefined>(undefined)
	const lastSelectionScroll = useRef("")
	const anchor = useRef({ row: 1, col: 2 })
	const dragSelection = useRef<{ moved: boolean } | null>(null)
	const suppressDragClick = useRef(false)
	const requests = useRef(Promise.resolve<unknown>(undefined))
	const viewRequest = useRef(0)
	const viewTimer = useRef<number | undefined>(undefined)
	const viewRef = useRef<BatchWorksheetView>({ sheet: "current", range: "C2" })
	const pendingView = useRef<PendingView | null>(null)
	const viewQueued = useRef(false)
	const viewQueueGeneration = useRef(0)
	const formulaSaving = useRef(false)
	const pendingFormulaNavigation = useRef<{ patch: Partial<BatchWorksheetView>; deferSelection: boolean } | null>(null)
	const draftRef = useRef<WorksheetDraft>({ version: 1, taskId })
	const draftTimer = useRef<number | undefined>(undefined)
	const resizeCleanup = useRef<(() => void) | null>(null)
	useEffect(() => () => resizeCleanup.current?.(), [])
	useEffect(() => {
		let closed = false
		void LoomLoomServiceClient.creatorCommand(request({ taskId, command: { action: "loadDraft" } }))
			.then((response) => {
				if (closed) return
				const payload = JSON.parse(response.value) as { draft?: unknown; updatedAt?: number | null }
				const saved = validCreatorDraft(payload.draft)
				const updatedAt = Number.isSafeInteger(payload.updatedAt) ? (payload.updatedAt as number) : null
				if (updatedAt !== null && updatedAt < (creatorHostUpdatedAt.current ?? 0)) return
				creatorHostUpdatedAt.current = updatedAt
				if (saved && !creatorTouched.current) {
					if (!restoredDraft?.creator || !updatedAt || creatorLocalAt.current <= updatedAt) {
						lastQueuedCreator.current = saved
						creatorLocalAt.current = updatedAt ?? Date.now()
						setCreatorDraft(saved)
					}
				} else if (!saved && !restoredDraft?.creator && !creatorTouched.current) {
					lastQueuedCreator.current = creatorDraftRef.current
				}
			})
			.catch((cause) => {
				if (!closed) {
					lastQueuedCreator.current = creatorDraftRef.current
					setError(`无法读取已保存的创作草稿：${message(cause)}`)
				}
			})
			.finally(() => {
				if (!closed) {
					setCreatorLoaded(true)
					setCreatorHostReady(true)
				}
			})
		return () => {
			closed = true
		}
	}, [taskId, restoredDraft?.creator])
	const saveCreatorDraft = useCallback(
		(draft: CreatorDraft) => {
			if (creatorConflictRef.current || lastQueuedCreator.current === draft) return creatorSaveQueue.current
			const generation = creatorSaveGeneration.current
			lastQueuedCreator.current = draft
			creatorQueuedSaves.current++
			creatorSaveQueue.current = creatorSaveQueue.current
				.catch(() => {})
				.then(() => {
					if (generation !== creatorSaveGeneration.current) return undefined
					if (creatorConflictRef.current) throw new Error("请先处理与 Cline 的草稿冲突。")
					return LoomLoomServiceClient.creatorCommand(
						request({
							taskId,
							command: { action: "saveDraft", draft, expectedUpdatedAt: creatorHostUpdatedAt.current },
						}),
					)
				})
				.then((response) => {
					if (!response) return
					const saved = JSON.parse(response.value) as { updatedAt?: number }
					if (Number.isSafeInteger(saved.updatedAt))
						creatorHostUpdatedAt.current = Math.max(creatorHostUpdatedAt.current ?? 0, saved.updatedAt!)
				})
				.catch((cause) => {
					if (generation !== creatorSaveGeneration.current) return
					lastQueuedCreator.current = null
					setError(`创作草稿未能保存：${message(cause)}`)
				})
				.finally(() => {
					creatorQueuedSaves.current--
				})
			return creatorSaveQueue.current
		},
		[taskId],
	)
	useEffect(() => {
		if (!creatorLoaded || !creatorHostReady) return
		const timer = window.setTimeout(() => saveCreatorDraft(creatorDraft), 350)
		return () => window.clearTimeout(timer)
	}, [creatorDraft, creatorLoaded, creatorHostReady, saveCreatorDraft])
	useEffect(() => {
		const flush = () => {
			if (creatorLoadedRef.current && creatorHostReadyRef.current) saveCreatorDraft(creatorDraftRef.current)
		}
		const onVisibility = () => {
			if (document.visibilityState === "hidden") flush()
		}
		window.addEventListener("pagehide", flush)
		document.addEventListener("visibilitychange", onVisibility)
		return () => {
			window.removeEventListener("pagehide", flush)
			document.removeEventListener("visibilitychange", onVisibility)
			flush()
		}
	}, [saveCreatorDraft])
	// VS Code can suspend a hidden editor Webview. Persist the in-progress cell
	// and creator drafts; canonical Batch rows and runs remain host-owned.
	useLayoutEffect(() => {
		draftRef.current = {
			version: 1,
			taskId,
			formula: formulaDirty ? { value: formula, revision: formulaRevision, target: formulaTarget } : undefined,
			editor: editor ?? undefined,
			inline: inlineEdit ?? undefined,
			pendingInline: Object.values(pendingInlineEdits),
			failedInline: Object.values(failedInlineEdits),
			surface: creatorMode ? "creator" : "sheet",
			creator: creatorLoaded ? creatorDraft : undefined,
			creatorLocalAt: creatorLoaded ? creatorLocalAt.current : undefined,
		}
		if (draftTimer.current !== undefined) window.clearTimeout(draftTimer.current)
		draftTimer.current = window.setTimeout(() => {
			setWebviewState(draftRef.current)
			draftTimer.current = undefined
		}, 300)
	}, [
		taskId,
		formula,
		formulaDirty,
		formulaRevision,
		formulaTarget,
		editor,
		inlineEdit,
		pendingInlineEdits,
		failedInlineEdits,
		creatorMode,
		creatorDraft,
		creatorLoaded,
	])
	useEffect(() => {
		const flush = () => {
			if (draftTimer.current !== undefined) window.clearTimeout(draftTimer.current)
			draftTimer.current = undefined
			setWebviewState(draftRef.current)
		}
		const onVisibility = () => {
			if (document.visibilityState === "hidden") flush()
		}
		window.addEventListener("pagehide", flush)
		document.addEventListener("visibilitychange", onVisibility)
		return () => {
			window.removeEventListener("pagehide", flush)
			document.removeEventListener("visibilitychange", onVisibility)
			flush()
		}
	}, [])
	useEffect(() => {
		viewRequest.current++
		viewQueueGeneration.current++
		viewQueued.current = false
		if (viewTimer.current !== undefined) window.clearTimeout(viewTimer.current)
		viewTimer.current = undefined
		pendingView.current = null
		lastSelectionScroll.current = ""
		setLocalView(null)
		setHostView(null)
	}, [taskId])
	useEffect(
		() => () => {
			viewQueueGeneration.current++
			pendingView.current = null
			if (viewTimer.current !== undefined) window.clearTimeout(viewTimer.current)
			if (compositionTimer.current !== undefined) window.clearTimeout(compositionTimer.current)
		},
		[],
	)
	useEffect(() => {
		const finishDrag = () => {
			if (dragSelection.current?.moved) {
				suppressDragClick.current = true
				window.setTimeout(() => {
					suppressDragClick.current = false
				}, 0)
			}
			dragSelection.current = null
		}
		window.addEventListener("mouseup", finishDrag)
		window.addEventListener("blur", finishDrag)
		return () => {
			window.removeEventListener("mouseup", finishDrag)
			window.removeEventListener("blur", finishDrag)
		}
	}, [])
	useEffect(() => {
		let closed = false
		let updates = 0
		setConnection("连接中")
		const unsubscribe = LoomLoomServiceClient.subscribeBatchTable(request({ taskId }), {
			onResponse: (response) => {
				if (!closed) {
					updates++
					const incoming = JSON.parse(response.value) as
						| BatchTableSnapshot
						| { kind: "view"; worksheet: BatchWorksheetView; editable: boolean }
						| { kind: "creator"; draft: unknown; updatedAt: number; editable: boolean }
					if ("session" in incoming) {
						setSnapshot(incoming)
						setHostView(incoming.session?.worksheet ?? null)
					} else if (incoming.kind === "creator") {
						const next = validCreatorDraft(incoming.draft)
						if (
							next &&
							Number.isSafeInteger(incoming.updatedAt) &&
							incoming.updatedAt > (creatorHostUpdatedAt.current ?? 0)
						) {
							const localUnsaved = creatorHostReadyRef.current
								? creatorDraftRef.current !== lastQueuedCreator.current || creatorQueuedSaves.current > 0
								: !!restoredDraft?.creator && creatorLocalAt.current > incoming.updatedAt
							creatorHostUpdatedAt.current = incoming.updatedAt
							setCreatorLoaded(true)
							setCreatorHostReady(true)
							if (localUnsaved) {
								creatorSaveGeneration.current++
								creatorConflictRef.current = true
								setCreatorConflict({ draft: next, updatedAt: incoming.updatedAt })
								setError("Cline 已更新创造草稿；你有未保存的本地编辑，请选择保留哪一版。")
							} else {
								lastQueuedCreator.current = next
								creatorLocalAt.current = incoming.updatedAt
								setCreatorDraft(next)
								setCreatorConflict(null)
							}
						}
						setSnapshot((current) =>
							current && current.editable !== incoming.editable
								? { ...current, editable: incoming.editable }
								: current,
						)
					} else {
						setHostView(incoming.worksheet)
						setSnapshot((current) =>
							current && current.editable !== incoming.editable
								? { ...current, editable: incoming.editable }
								: current,
						)
					}
					setConnection("已同步")
				}
			},
			onError: (e) => {
				if (!closed) {
					setConnection("连接中断")
					setError(message(e))
				}
			},
			onComplete: () => {
				if (!closed) setConnection("连接已关闭")
			},
		})
		const focus = () => {
			const requestedAtUpdate = updates
			void LoomLoomServiceClient.getBatchTableSnapshot(request({ taskId }))
				.then((response) => {
					if (!closed && updates === requestedAtUpdate) {
						const incoming = JSON.parse(response.value) as BatchTableSnapshot
						setSnapshot(incoming)
						setHostView(incoming.session?.worksheet ?? null)
					}
				})
				.catch((e) => {
					if (!closed) setError(message(e))
				})
		}
		window.addEventListener("focus", focus)
		return () => {
			closed = true
			unsubscribe()
			window.removeEventListener("focus", focus)
		}
	}, [taskId, reconnect])
	const session = snapshot?.session
	const editorCanMutate =
		!!editor &&
		editor.sheet === "current" &&
		!!snapshot?.editable &&
		!!session?.enabled &&
		!session.attempt &&
		session.phase !== "quoting"
	const editLeaseActive =
		formulaDirty || !!inlineEdit || editorCanMutate || pendingInlineCount > 0 || Object.keys(failedInlineEdits).length > 0
	editLeaseActiveRef.current = editLeaseActive
	useEffect(() => {
		if (!panelId) return
		const onDraftProbe = (event: MessageEvent) => {
			const incoming = event.data as { type?: unknown; panelId?: unknown; requestId?: unknown } | null
			if (
				!incoming ||
				incoming.type !== "batch_table_draft_probe" ||
				incoming.panelId !== panelId ||
				(typeof incoming.requestId !== "string" && typeof incoming.requestId !== "number")
			)
				return
			PLATFORM_CONFIG.postMessage({
				type: "batch_table_draft_probe_response",
				panelId,
				requestId: incoming.requestId,
				dirty:
					editLeaseDesired.current ||
					editLeaseActiveRef.current ||
					pendingInlineCountRef.current > 0 ||
					!!draftRef.current.inline ||
					!!draftRef.current.formula ||
					!!draftRef.current.pendingInline?.length ||
					!!draftRef.current.failedInline?.length,
			})
		}
		window.addEventListener("message", onDraftProbe)
		return () => window.removeEventListener("message", onDraftProbe)
	}, [panelId])
	const setHostEditLease = useCallback(
		(editing: boolean): Promise<void> => {
			if (!panelId || !session?.id) return Promise.resolve()
			const batchId = session.id
			const next = editLeaseQueue.current
				.catch(() => {})
				.then(async () => {
					if (editLeaseAcknowledged.current === editing) return
					await LoomLoomServiceClient.worksheetOperation(
						request({ taskId, operation: { action: "edit_state", panelId, batchId, editing } }),
					)
					editLeaseAcknowledged.current = editing
				})
			editLeaseQueue.current = next
			return next
		},
		[taskId, panelId, session?.id],
	)
	const scheduleEditLeaseRetry = useCallback(() => {
		if (editLeaseRetryTimer.current !== undefined) return
		editLeaseRetryTimer.current = window.setTimeout(() => {
			editLeaseRetryTimer.current = undefined
			setEditLeaseRetry((attempt) => attempt + 1)
		}, 900)
	}, [])
	useEffect(() => {
		editLeaseDesired.current = editLeaseActive
		if (!panelId || !session?.id) return
		if (editLeaseReleaseTimer.current !== undefined) window.clearTimeout(editLeaseReleaseTimer.current)
		editLeaseReleaseTimer.current = undefined
		if (editLeaseActive) {
			void setHostEditLease(true)
				.then(() => {
					if (editLeaseDesired.current) setEditLeaseError("")
				})
				.catch((cause) => {
					if (!editLeaseDesired.current) return
					setEditLeaseError(`无法保护未保存的工作表输入：${message(cause)}`)
					scheduleEditLeaseRetry()
				})
		} else {
			if (editLeaseRetryTimer.current !== undefined) window.clearTimeout(editLeaseRetryTimer.current)
			editLeaseRetryTimer.current = undefined
			editLeaseReleaseTimer.current = window.setTimeout(() => {
				editLeaseReleaseTimer.current = undefined
				if (editLeaseDesired.current) return
				void setHostEditLease(false).catch((cause) => {
					setEditLeaseError(`无法释放工作表编辑保护：${message(cause)}`)
					scheduleEditLeaseRetry()
				})
			}, 150)
		}
	}, [editLeaseActive, editLeaseRetry, panelId, session?.id, setHostEditLease, scheduleEditLeaseRetry])
	useEffect(
		() => () => {
			if (editLeaseRetryTimer.current !== undefined) window.clearTimeout(editLeaseRetryTimer.current)
			if (editLeaseReleaseTimer.current !== undefined) window.clearTimeout(editLeaseReleaseTimer.current)
			// Hidden Webviews can be destroyed. Never release an edit lease while
			// the local state still contains a draft or an uncertain write.
			if (!editLeaseDesired.current) void setHostEditLease(false).catch(() => {})
		},
		[setHostEditLease],
	)
	const taskCount = effectiveTaskCount(session?.rows ?? [])
	useEffect(() => {
		setRowsToAdd((count) => Math.min(count, Math.max(1, 100 - taskCount)))
	}, [taskCount])
	const view = localView ?? hostView ?? session?.worksheet ?? { sheet: "current", range: "C2" }
	viewRef.current = view
	const sheet = useMemo(() => {
		if (!session) return null
		try {
			return buildSheet(session, view.sheet)
		} catch {
			return buildSheet(session)
		}
	}, [session, view.sheet])
	const zoom = (view.zoom ?? 100) / 100
	const rowHeight = (view.wrap ? WRAPPED_ROW_HEIGHT : GRID_ROW_HEIGHT) * zoom
	const headerHeight = GRID_HEADER_HEIGHT * zoom
	// The DOM remains virtualized: blank visual rows are not Batch tasks until
	// written. Keep the addressable canvas large enough for an Excel-like jump.
	const rowCount = Math.max(999, sheet?.rows.length ?? 0)
	const visibleRows = useMemo(() => {
		const first = Math.min(
			rowCount,
			Math.max(0, Math.floor(Math.max(0, viewport.top - headerHeight) / rowHeight) - GRID_OVERSCAN),
		)
		const count = Math.ceil(Math.max(300, viewport.height) / rowHeight) + GRID_OVERSCAN * 2
		const end = Math.min(rowCount, first + count)
		return { first, end, rows: Array.from({ length: end - first }, (_, index) => first + index + 1) }
	}, [headerHeight, rowCount, rowHeight, viewport])
	useEffect(() => {
		const grid = gridRef.current
		if (!grid) return
		let frame = 0
		const measure = () => {
			const top = Math.floor(grid.scrollTop / (rowHeight * 4)) * rowHeight * 4
			const height = grid.clientHeight || 600
			setViewport((previous) => (previous.top === top && previous.height === height ? previous : { top, height }))
		}
		const onScroll = () => {
			if (!frame)
				frame = requestAnimationFrame(() => {
					frame = 0
					measure()
				})
		}
		const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
		observer?.observe(grid)
		grid.addEventListener("scroll", onScroll, { passive: true })
		window.addEventListener("resize", measure)
		measure()
		return () => {
			if (frame) cancelAnimationFrame(frame)
			observer?.disconnect()
			grid.removeEventListener("scroll", onScroll)
			window.removeEventListener("resize", measure)
		}
	}, [!!sheet, rowHeight])
	const range = useMemo(() => {
		try {
			return parseRange(view.range)
		} catch {
			return parseRange("C2")
		}
	}, [view.range])
	const cellAddress = selectionAddress(range.top, range.left)
	const selectedValue = sheet ? sheetValue(sheet, range.top, range.left, true) : ""
	const selectedVisualBlank = !!sheet && range.top > 0 && !sheet.rows[range.top - 1]?.row.id
	const editable = !!snapshot?.editable && !!sheet && !sheet.readOnly
	const rowControlsEnabled =
		editable &&
		!!session?.listing &&
		sheet?.id === "current" &&
		!busy &&
		!formulaDirty &&
		!editor &&
		!inlineEdit &&
		pendingInlineCount === 0 &&
		Object.keys(failedInlineEdits).length === 0 &&
		connection === "已同步"
	const selectedInputRows = useMemo(
		() =>
			sheet && range.top >= 1
				? sheet.rows.slice(range.top - 1, Math.min(range.bottom, sheet.rows.length)).filter((item) => !!item.row.id)
				: [],
		[sheet, range.top, range.bottom],
	)
	const field = sheet?.columns[range.left]?.field
	const inputFileMode = getBatchFileInputMode(field)
	const canEdit = editable && range.top > 0 && range.top <= rowCount && !!field && field.value_type !== "asset_ref"
	const textEditable = canEdit && isInlineTextField(field)
	useEffect(() => {
		if (!formulaDirty) {
			setFormula(selectedValue)
			setFormulaRevision(session?.revision ?? 0)
			setFormulaTarget({ sheet: sheet?.id ?? "current", address: cellAddress })
		}
	}, [selectedValue, session?.revision, formulaDirty, cellAddress, sheet?.id])
	const formulaWritable = !!snapshot?.editable && !!session?.enabled && !session?.attempt && session?.phase !== "quoting"
	useEffect(() => {
		setAddressInput(view.range)
	}, [view.range])
	useEffect(() => {
		const key = `${session?.id}:${view.sheet}:${cellAddress}`
		if (lastSelectionScroll.current === key) return
		lastSelectionScroll.current = key
		const grid = gridRef.current
		if (!grid || !sheet) return
		const target = grid.querySelector(`[data-address="${cellAddress}"]`)
		if (target) {
			target.scrollIntoView?.({ block: "nearest", inline: "nearest" })
			return
		}
		// The selected address may be outside the rendered window. Scroll its
		// spreadsheet coordinate into view so virtual rows can mount it.
		if (range.top > 0) {
			grid.scrollTop = Math.max(0, headerHeight + (range.top - 1) * rowHeight - grid.clientHeight / 2)
			setViewport({ top: grid.scrollTop, height: grid.clientHeight || 600 })
		}
		const left = sheet.columns
			.slice(0, range.left)
			.reduce((sum, column, index) => sum + (view.columnWidths?.[columnLetter(index)] ?? column.width), 42)
		grid.scrollLeft = Math.max(0, left * zoom - grid.clientWidth / 2)
	}, [cellAddress, range.top, range.left, headerHeight, rowHeight, session?.id, sheet, view.sheet, view.columnWidths, zoom])
	useEffect(() => {
		if (editor) dialogRef.current?.focus()
	}, [!!editor])
	useEffect(() => {
		if (!inlineEdit) return
		const input = inlineInputRef.current
		// Moving focus or the caret during an active IME composition can discard
		// its uncommitted candidate. The capture textarea is the same DOM node.
		if (!composing.current) {
			if (input && document.activeElement !== input) input.focus({ preventScroll: true })
			input?.setSelectionRange(input.value.length, input.value.length)
		}
	}, [inlineEdit?.address])
	const dispatch = useCallback(
		(operation: Record<string, unknown> | (() => Record<string, unknown> | null), quiet = false) => {
			if (!quiet) {
				setBusy(true)
				setError("")
			}
			const next = requests.current
				.catch(() => {})
				.then(async () => {
					const resolved = typeof operation === "function" ? operation() : operation
					if (!resolved) return null
					const result = await LoomLoomServiceClient.worksheetOperation(request({ taskId, operation: resolved }))
					return JSON.parse(result.value)
				})
			requests.current = next
			return next
				.catch((e) => {
					setError(message(e))
					throw e
				})
				.finally(() => {
					if (!quiet) setBusy(false)
				})
		},
		[taskId],
	)
	const act = (operation: Record<string, unknown>) => {
		void dispatch({ sheet: sheet?.id, range: view.range, ...operation }).catch(() => {})
	}
	async function outputAction(action: "chooseOutputDirectory" | "exportRunToDirectory", runId?: string) {
		if (busy) return
		setBusy(true)
		setError("")
		const next = requests.current
			.catch(() => {})
			.then(() => LoomLoomServiceClient.batchTableAction(request({ taskId, action, ...(runId ? { runId } : {}) })))
		requests.current = next
		try {
			const result = JSON.parse((await next).value) as { cancelled?: boolean; failed?: number }
			if (!result.cancelled && result.failed) setError(`${result.failed} 个产物未能另存，云端结果仍可查看。`)
		} catch (cause) {
			setError(message(cause))
		} finally {
			setBusy(false)
		}
	}
	async function runCommand(command: BatchCommand): Promise<BatchSession | null> {
		// Finish pending worksheet RPCs first. The captured revision/quote still has
		// to match on the host, so a newer edit can never be silently approved.
		if (
			busy ||
			formulaDirty ||
			editor ||
			inlineEdit ||
			pendingInlineCountRef.current > 0 ||
			Object.keys(failedInlineEdits).length > 0 ||
			!snapshot?.editable ||
			!session?.enabled ||
			sheet?.history ||
			connection !== "已同步"
		)
			return null
		setBusy(true)
		setError("")
		const next = requests.current.catch(() => {}).then(() => sendBatch(command, taskId))
		requests.current = next
		try {
			return await next
		} catch (e) {
			setError(message(e))
			return null
		} finally {
			setBusy(false)
		}
	}
	async function addRows() {
		if (!rowControlsEnabled || !session || !sheet || rowsToAdd > 100 - taskCount) return
		const before = new Map(session.rows.map((row) => [row.id, row.origin]))
		const updated = await runCommand({ action: "addRows", revision: session.revision, count: rowsToAdd })
		if (updated) {
			const first = updated.rows.find(
				(row) => !before.has(row.id) || (before.get(row.id) === "implicit" && row.origin === "explicit"),
			)
			const index = first ? updated.rows.indexOf(first) : Math.max(0, updated.rows.length - rowsToAdd)
			const excelRow = first?.sheetRowNumber ?? updated.rows[index]?.sheetRowNumber ?? index + 2
			changeView({ sheet: "current", range: `C${excelRow}` })
		}
	}
	function askToDeleteRows() {
		if (!rowControlsEnabled || !session || !sheet || range.top < 1) return
		const deletion: RowDeletion = {
			revision: session.revision,
			range: selectionAddress(range.top, 0, range.bottom, sheet.columns.length - 1),
			count: range.bottom - range.top + 1,
			top: range.top,
			filled: selectedInputRows.filter((item) =>
				Object.values(item.row.values).some((value) => value !== "" && value !== null && value !== undefined),
			).length,
			files: selectedInputRows.reduce((sum, item) => sum + item.row.attachments.length, 0),
		}
		if (deletion.filled || deletion.files) setPendingDelete(deletion)
		else void deleteRows(deletion, false)
	}
	async function deleteRows(deleted: RowDeletion, confirmed: boolean) {
		if (!rowControlsEnabled || !session || session.revision !== deleted.revision) return
		setBusy(true)
		try {
			await ensureEditLeaseReleased()
			await dispatch(
				{
					action: "delete_visual_rows",
					sheet: "current",
					range: deleted.range,
					revision: deleted.revision,
					...(confirmed ? { confirmed: true } : {}),
				},
				true,
			)
			setPendingDelete(null)
			changeView({ sheet: "current", range: selectionAddress(Math.max(1, Math.min(deleted.top, rowCount)), 2) })
		} catch {
			/* Keep the selected row and any confirmation visible after a failed CAS. */
		} finally {
			setBusy(false)
		}
	}
	function changeView(patch: Partial<BatchWorksheetView>, deferSelection = false, committedFormula = false) {
		if (formulaDirty && !committedFormula && (patch.range !== undefined || patch.sheet !== undefined)) {
			pendingFormulaNavigation.current = { patch, deferSelection }
			if (!formulaSaving.current) {
				formulaSaving.current = true
				void saveFormula().then((saved) => {
					formulaSaving.current = false
					const next = pendingFormulaNavigation.current
					pendingFormulaNavigation.current = null
					if (saved && next) changeView(next.patch, next.deferSelection, true)
				})
			}
			return
		}
		const next = { ...viewRef.current, ...patch }
		const requestId = ++viewRequest.current
		viewRef.current = next
		setLocalView(next)
		if (viewTimer.current !== undefined) window.clearTimeout(viewTimer.current)
		viewTimer.current = undefined
		const persist = () => {
			viewTimer.current = undefined
			pendingView.current = { next, patch, requestId }
			if (viewQueued.current) return
			viewQueued.current = true
			const generation = viewQueueGeneration.current
			let sent: PendingView | null = null
			void dispatch(() => {
				if (generation !== viewQueueGeneration.current) return null
				sent = pendingView.current
				pendingView.current = null
				viewQueued.current = false
				return sent ? { action: "view", sheet: sent.next.sheet, range: sent.next.range, ...sent.patch } : null
			}, true)
				.then((saved: BatchWorksheetView) => {
					if (sent && viewRequest.current === sent.requestId && saved?.sheet && saved?.range) setHostView(saved)
				})
				.catch(() => {})
				.finally(() => {
					if (sent && viewRequest.current === sent.requestId) setLocalView(null)
				})
		}
		// Selection is presentation state. Keep clicks and arrow keys synchronous in
		// this Webview, then only persist the latest address to the extension host.
		if (deferSelection) viewTimer.current = window.setTimeout(persist, 110)
		else persist()
	}
	function focusSelectedInputSoon() {
		window.requestAnimationFrame(() => {
			const grid = gridRef.current
			const active = document.activeElement
			if (grid && (active === grid || active === document.body || grid.contains(active))) {
				keyboardCaptureRef.current?.focus({ preventScroll: true })
			}
		})
	}
	function select(row: number, col: number, extend = false) {
		if (!sheet) return
		row = Math.max(0, Math.min(row, rowCount))
		col = Math.max(0, Math.min(col, sheet.columns.length - 1))
		if (!extend) anchor.current = { row, col }
		changeView(
			{
				range: selectionAddress(
					Math.min(row, anchor.current.row),
					Math.min(col, anchor.current.col),
					Math.max(row, anchor.current.row),
					Math.max(col, anchor.current.col),
				),
			},
			true,
		)
		if (!formulaDirty) focusSelectedInputSoon()
	}
	function openEditor(row = range.top, col = range.left) {
		if (formulaDirty) {
			setError(`${formulaTarget.address} 有未保存内容，请先保存或取消。`)
			return
		}
		if (!sheet || !session || row < 1 || row > rowCount) return
		const address = selectionAddress(row, col),
			column = sheet.columns[col],
			f = column?.field,
			artifact = column?.kind === "output" ? sheet.rows[row - 1]?.artifacts[column.outputIndex ?? 0] : undefined
		if (editable && f) void ensureEditLease().catch(() => {})
		setEditor({
			address,
			sheet: sheet.id,
			row,
			col,
			revision: session.revision,
			// A signed accessUrl is transient cloud metadata, not a durable editor draft.
			value: f
				? (sheet.rows[row - 1]?.row.values[f.key] ?? "")
				: artifact?.inlineText !== undefined
					? artifact.inlineText
					: sheetValue(sheet, row, col),
		})
	}
	function beginCellEdit(row = range.top, col = range.left, replaceWith?: string) {
		if (formulaDirty || busy || !sheet || !session || row < 1 || row > rowCount) return
		const field = sheet.columns[col]?.field
		if (!editable || !field) {
			if (replaceWith === undefined) openEditor(row, col)
			return
		}
		if (!isInlineTextField(field)) {
			if (pendingInlineCount > 0) {
				setError("请等待前面的单元格保存完成，再使用此字段的选项或文件编辑器。")
				return
			}
			openEditor(row, col)
			return
		}
		const address = selectionAddress(row, col)
		const failed = failedInlineEdits[address]
		const original = pendingInlineEdits[address]?.value ?? sheet.rows[row - 1]?.row.values[field.key]
		const initial = original === undefined || original === null ? "" : String(original)
		inlineClosing.current = false
		void ensureEditLease().catch(() => {})
		setInlineEdit(
			failed ?? {
				address,
				sheet: sheet.id,
				row,
				col,
				revision: Math.max(session.revision, lastOwnRevision.current),
				original: initial,
				value: replaceWith ?? initial,
			},
		)
	}
	function nextInputCell(row: number, col: number, backwards = false) {
		if (!sheet) return { row, col }
		const columns = sheet.columns.flatMap((column, index) =>
			column.kind === "input" && column.field?.value_type !== "asset_ref" ? [index] : [],
		)
		if (!columns.length) return { row, col }
		const index = columns.indexOf(col)
		const next = backwards ? index - 1 : index + 1
		if (next >= 0 && next < columns.length) return { row, col: columns[next] }
		return {
			row: Math.max(1, Math.min(rowCount, row + (backwards ? -1 : 1))),
			col: backwards ? columns.at(-1)! : columns[0],
		}
	}
	async function ensureEditLease() {
		if (!panelId) return
		if (!session?.id) throw new Error("工作表尚未连接，无法安全保存输入。")
		if (editLeaseReleaseTimer.current !== undefined) window.clearTimeout(editLeaseReleaseTimer.current)
		editLeaseReleaseTimer.current = undefined
		editLeaseDesired.current = true
		try {
			await setHostEditLease(true)
			setEditLeaseError("")
		} catch (cause) {
			setEditLeaseError(`无法保护未保存的工作表输入：${message(cause)}`)
			scheduleEditLeaseRetry()
			throw cause
		}
	}
	async function ensureEditLeaseReleased() {
		if (!panelId) return
		if (editLeaseReleaseTimer.current !== undefined) window.clearTimeout(editLeaseReleaseTimer.current)
		editLeaseReleaseTimer.current = undefined
		editLeaseDesired.current = false
		try {
			await setHostEditLease(false)
			setEditLeaseError("")
		} catch (cause) {
			setEditLeaseError(`无法释放工作表编辑保护：${message(cause)}`)
			throw cause
		}
	}
	async function dispatchWithEditLease(operation: Record<string, unknown>) {
		setBusy(true)
		setError("")
		try {
			await ensureEditLease()
			return await dispatch(operation, true)
		} finally {
			if (!editLeaseActive) {
				editLeaseDesired.current = false
				try {
					await setHostEditLease(false)
				} catch (cause) {
					setEditLeaseError(`无法释放工作表编辑保护：${message(cause)}`)
				}
			}
			setBusy(false)
		}
	}
	function commitInline(move?: { row: number; col: number }) {
		if (!inlineEdit || !session || busy || inlineClosing.current) return
		inlineClosing.current = true
		const pending = inlineEdit
		setInlineEdit(null)
		if (move) select(move.row, move.col)
		if (pending.value === pending.original) {
			setFailedInlineEdits((current) => {
				const next = { ...current }
				delete next[pending.address]
				return next
			})
			return
		}
		if (pendingInlineCountRef.current === 0) {
			inlineWriteRevision.current = pending.revision
			inlineWriteFailed.current = false
		}
		pendingInlineCountRef.current++
		setPendingInlineCount(pendingInlineCountRef.current)
		setPendingInlineEdits((current) => ({ ...current, [pending.address]: pending }))
		const next = requests.current
			.catch(() => {})
			.then(async () => {
				if (inlineWriteFailed.current) throw new Error("前一个单元格未保存；后续输入已保留为草稿。")
				try {
					await ensureEditLease()
					const response = await LoomLoomServiceClient.worksheetOperation(
						request({
							taskId,
							operation: {
								action: "write",
								sheet: pending.sheet,
								range: pending.address,
								revision: inlineWriteRevision.current,
								values: [[pending.value]],
							},
						}),
					)
					const saved = JSON.parse(response.value) as { revision?: number }
					if (!Number.isSafeInteger(saved.revision)) throw new Error("单元格已提交但缺少版本确认，请核对工作表。")
					inlineWriteRevision.current = saved.revision!
					lastOwnRevision.current = Math.max(lastOwnRevision.current, saved.revision!)
					return saved
				} catch (cause) {
					inlineWriteFailed.current = true
					throw cause
				}
			})
		requests.current = next
		void next
			.then(() => {
				setPendingInlineEdits((current) => {
					if (current[pending.address] !== pending) return current
					const result = { ...current }
					delete result[pending.address]
					return result
				})
				setFailedInlineEdits((current) => {
					if (!current[pending.address]) return current
					const result = { ...current }
					delete result[pending.address]
					return result
				})
			})
			.catch((cause) => {
				setError(`未能保存 ${pending.address}：${message(cause)}。草稿已保留，请逐格核对。`)
				setPendingInlineEdits((current) => {
					if (current[pending.address] !== pending) return current
					const result = { ...current }
					delete result[pending.address]
					return result
				})
				setFailedInlineEdits((current) => ({ ...current, [pending.address]: pending }))
			})
			.finally(() => {
				pendingInlineCountRef.current = Math.max(0, pendingInlineCountRef.current - 1)
				setPendingInlineCount(pendingInlineCountRef.current)
				if (pendingInlineCountRef.current === 0) {
					inlineWriteRevision.current = null
					inlineWriteFailed.current = false
				}
			})
	}
	async function saveFormula(moveDown = false): Promise<boolean> {
		if (!formulaDirty || !formulaWritable || busy) return false
		try {
			await ensureEditLease()
			await dispatch({
				action: "write",
				sheet: formulaTarget.sheet,
				range: formulaTarget.address,
				revision: formulaRevision,
				values: [[formula]],
			})
			setFormulaDirty(false)
			if (moveDown) {
				const target = parseRange(formulaTarget.address)
				changeView({ range: selectionAddress(Math.min(rowCount, target.top + 1), target.left) }, true, true)
			}
			return true
		} catch {
			/* Preserve unsaved text. */
			return false
		}
	}
	function pasteGridText(text: string) {
		if (formulaDirty || inlineEdit || pendingInlineCount > 0) {
			setError("请先保存或取消正在编辑的单元格，再粘贴表格数据。")
			return
		}
		try {
			const values = parseTsv(text)
			void dispatchWithEditLease({
				action: "write",
				sheet: sheet?.id,
				range: cellAddress,
				revision: session?.revision,
				values,
			}).catch(() => {})
		} catch (cause) {
			setError(message(cause))
		}
	}
	function keyboard(e: KeyboardEvent<HTMLElement>, fromCapture = false) {
		if (!fromCapture && e.target !== e.currentTarget) return
		if (composing.current || e.nativeEvent.isComposing) return
		if (justFinishedComposition.current && e.key === "Enter") {
			e.preventDefault()
			return
		}
		if ((e.ctrlKey || e.metaKey) && e.key === "-") {
			e.preventDefault()
			askToDeleteRows()
			return
		}
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
			e.preventDefault()
			act({ action: "copy" })
			return
		}
		const moves: Record<string, [number, number]> = {
			ArrowDown: [1, 0],
			ArrowUp: [-1, 0],
			ArrowLeft: [0, -1],
			ArrowRight: [0, 1],
		}
		if (e.key === "Tab" && editable) {
			e.preventDefault()
			const next = nextInputCell(range.top, range.left, e.shiftKey)
			select(next.row, next.col)
			return
		}
		if (moves[e.key]) {
			e.preventDefault()
			const [dr, dc] = moves[e.key]
			select(
				(e.shiftKey ? range.bottom : range.top) + dr,
				(e.shiftKey ? range.right : range.left) + dc,
				e.shiftKey && e.key !== "Tab",
			)
			return
		}
		if (e.key === "F2") {
			e.preventDefault()
			beginCellEdit()
			return
		}
		if (e.key === "Enter") {
			e.preventDefault()
			select(range.top + (e.shiftKey ? -1 : 1), range.left)
			return
		}
		if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
			e.preventDefault()
			beginCellEdit(range.top, range.left, e.key)
			return
		}
		if (
			e.key === "Delete" &&
			editable &&
			!busy &&
			pendingInlineCount === 0 &&
			!formulaDirty &&
			Object.keys(failedInlineEdits).length === 0
		) {
			e.preventDefault()
			void dispatchWithEditLease({
				action: "write",
				sheet: sheet?.id,
				range: view.range,
				revision: session?.revision,
				values: Array.from({ length: range.bottom - range.top + 1 }, () => Array(range.right - range.left + 1).fill("")),
			}).catch(() => {})
		}
	}
	const boldRanges = useMemo(() => (view.boldRanges ?? []).map(parseRange), [view.boldRanges])
	const localOutputs = useMemo(
		() =>
			new Map((session?.localOutputs ?? []).map((file) => [`${file.runId}:${file.rowIndex}:${file.artifactIndex}`, file])),
		[session?.localOutputs],
	)
	const editorSheet = useMemo(() => (session && editor ? buildSheet(session, editor.sheet) : null), [session, editor?.sheet])
	const previewColumn = editor && editorSheet?.columns[editor.col]
	const previewRow = editor && editorSheet?.rows[editor.row - 1]
	const previewArtifact = previewColumn?.kind === "output" ? previewRow?.artifacts[previewColumn.outputIndex ?? 0] : undefined
	const previewSaved =
		editorSheet?.runId && previewRow && previewColumn?.kind === "output"
			? localOutputs.get(`${editorSheet.runId}:${previewRow.sourceIndex}:${previewColumn.outputIndex ?? 0}`)
			: undefined
	const previewMime = (previewSaved?.mimeType ?? previewArtifact?.mimeType)?.split(";", 1)[0]?.trim().toLowerCase()
	const previewKey =
		editor &&
		editorSheet?.runId &&
		previewRow &&
		previewRow.sourceIndex >= 0 &&
		previewColumn?.kind === "output" &&
		previewMime &&
		MEDIA_PREVIEW_MIMES.has(previewMime)
			? `${editorSheet.runId}:${previewRow.sourceIndex}:${previewColumn.outputIndex ?? 0}:${previewMime}:${editor.address}`
			: undefined
	useEffect(() => {
		if (!previewKey || !editorSheet?.runId || !previewRow || previewColumn?.kind !== "output") {
			setMediaPreview(null)
			return
		}
		let active = true
		setMediaLoaded(false)
		setMediaPreview({ key: previewKey, status: "loading" })
		void LoomLoomServiceClient.batchTableAction(
			request({
				taskId,
				action: "previewArtifact",
				runId: editorSheet.runId,
				rowIndex: previewRow.sourceIndex,
				artifactIndex: previewColumn.outputIndex ?? 0,
			}),
		)
			.then((response) => {
				if (!active) return
				const data = JSON.parse(response.value) as { uri?: string; mimeType?: string; relativePath?: string }
				const mimeType = data.mimeType?.split(";", 1)[0]?.trim().toLowerCase()
				if (!data.uri || !mimeType || !MEDIA_PREVIEW_MIMES.has(mimeType))
					throw new Error("宿主未提供可预览的本地媒体文件。")
				setMediaPreview({ key: previewKey, status: "ready", uri: data.uri, mimeType, relativePath: data.relativePath })
			})
			.catch((cause) => {
				if (active) setMediaPreview({ key: previewKey, status: "error", error: message(cause) })
			})
		return () => {
			active = false
		}
	}, [previewKey, previewRetry, taskId])
	if (!session || !sheet)
		return (
			<main className="batch-worksheet">
				<div className="bw-empty">
					<h2>Batch 工作表</h2>
					<p>
						{snapshot
							? "此任务暂没有 Batch 数据，请在左侧选择 SkillBot，随后按需添加输入行。"
							: "正在连接当前 Cline 任务…"}
					</p>
					{error && <p role="alert">{error}</p>}
					<button onClick={() => setReconnect((n) => n + 1)}>重新连接</button>
				</div>
			</main>
		)
	if (creatorMode)
		return (
			<main className="batch-worksheet">
				<div className="bw-creator-surface">
					{!creatorLoaded && <p className="bw-notice">正在读取此任务的创作草稿…</p>}
					{creatorConflict && (
						<div className="bw-notice" role="alert">
							Cline 与你同时修改了创作草稿。请选择要保留的版本，系统不会自动覆盖。
							<button
								onClick={() => {
									creatorHostUpdatedAt.current = creatorConflict.updatedAt
									creatorLocalAt.current = creatorConflict.updatedAt
									lastQueuedCreator.current = creatorConflict.draft
									creatorConflictRef.current = false
									setCreatorDraft(creatorConflict.draft)
									setCreatorConflict(null)
									setError("")
								}}>
								载入 Cline 版本
							</button>
							<button
								onClick={() => {
									creatorHostUpdatedAt.current = creatorConflict.updatedAt
									creatorLocalAt.current = Date.now()
									lastQueuedCreator.current = null
									creatorConflictRef.current = false
									setCreatorConflict(null)
									setError("")
									saveCreatorDraft(creatorDraftRef.current)
								}}>
								保留我的版本并覆盖
							</button>
						</div>
					)}
					{error && (
						<p className="bw-error" role="alert">
							{error}
						</p>
					)}
					{creatorLoaded && (
						<CreatorWorkbench
							draft={creatorDraft}
							onBack={() => setCreatorMode(false)}
							onDraftChange={(draft) => {
								creatorTouched.current = true
								creatorLocalAt.current = Date.now()
								setCreatorDraft(draft)
							}}
							onFlushDraft={async () => {
								if (creatorConflictRef.current) throw new Error("请先处理与 Cline 的草稿冲突。")
								await saveCreatorDraft(creatorDraftRef.current)
								if (lastQueuedCreator.current === null) throw new Error("草稿未能保存，暂不交给 Cline。")
							}}
							readonly={!snapshot.editable || !session.enabled}
							taskId={taskId}
						/>
					)}
				</div>
			</main>
		)
	const progress = sheet.history?.progress ?? session.progress
	const shownDestination =
		sheet.history?.outputDestination ??
		(sheet.runId && sheet.runId === session.attempt?.runId ? session.attempt.outputDestination : session.outputDestination)
	const shownOutputRoot = batchOutputRoot(shownDestination)
	const ended = progress ? progress.completed + progress.failed + (progress.cancelled ?? 0) : 0
	const pct = progress?.total ? Math.min(100, Math.round((ended / progress.total) * 100)) : 0
	const cols = sheet.columns
	const width = (col: number) => view.columnWidths?.[columnLetter(col)] ?? cols[col].width
	const frozen = (col: number): CSSProperties =>
		view.freeze !== false && col < 2 ? { position: "sticky", left: 42 + (col === 1 ? width(0) : 0), zIndex: 2 } : {}
	const selected = (row: number, col: number) =>
		row >= range.top && row <= range.bottom && col >= range.left && col <= range.right
	const editorField = editorSheet?.columns[editor?.col ?? 0]?.field
	const editorRow = editorSheet?.rows[(editor?.row ?? 0) - 1]
	const editorFileMode = getBatchFileInputMode(editorField)
	const editorBlank = !editorRow?.row.id
	const editorDirty =
		!!editorField && JSON.stringify(editor?.value) !== JSON.stringify(editorRow?.row.values[editorField.key] ?? "")
	const editorFile =
		editor && editorSheet?.columns[editor.col]?.kind === "output"
			? localOutputs.get(
					`${editorSheet.runId}:${editorRow?.sourceIndex}:${editorSheet.columns[editor.col].outputIndex ?? 0}`,
				)
			: undefined
	const editorWritable =
		!!editorField && editorField.value_type !== "asset_ref" && !!snapshot.editable && !editorSheet?.readOnly
	const editorStale = !!editor && editor.revision !== session.revision
	return (
		<main
			className="batch-worksheet"
			style={{ "--bw-font": `${view.fontSize ?? 12}px`, "--bw-zoom": (view.zoom ?? 100) / 100 } as CSSProperties}>
			<header className="bw-title">
				<div>
					<span className="bw-icon">▦</span>
					<strong>{sheet.title}</strong>
					<span className="bw-muted"> / Batch 工作表</span>
				</div>
				<span className="bw-sync">
					● {connection} · v{session.revision}
				</span>
			</header>
			{sheet.history ? (
				<section aria-label="历史批次" className="bw-stage-bar bw-stage-history">
					<div className="bw-stage-main">
						<div className="bw-stage-heading">
							<strong>历史批次 · 只读</strong>
							<span>{effectiveTaskCount(sheet.history.rows)} 条任务</span>
						</div>
						<p>正在查看历史结果；不会操作当前输入或重复生成。</p>
					</div>
					<div className="bw-stage-actions">
						<button onClick={() => changeView({ sheet: "current", range: "C2" })} type="button">
							返回本批工作表
						</button>
					</div>
				</section>
			) : session.enabled ? (
				<BatchRunControls
					disabled={
						busy ||
						formulaDirty ||
						!!editor ||
						!!inlineEdit ||
						pendingInlineCount > 0 ||
						Object.keys(failedInlineEdits).length > 0 ||
						!snapshot.editable ||
						connection !== "已同步"
					}
					onCommand={runCommand}
					session={session}
					variant="worksheet"
				/>
			) : (
				<section aria-label="批处理下一步" className="bw-stage-bar">
					<div className="bw-stage-main">
						<div className="bw-stage-heading">
							<strong>Batch 已暂停</strong>
						</div>
						<p>当前对话已退出 Batch，输入保留为只读；切回 Batch 后可继续编辑。</p>
					</div>
				</section>
			)}
			<nav aria-label="表格工具" className="bw-ribbon">
				<button
					onClick={() => {
						void LoomLoomServiceClient.batchTableAction(request({ taskId, action: "focusChat" })).catch((e) =>
							setError(message(e)),
						)
					}}>
					返回 Batch 对话
				</button>
				<button
					disabled={formulaDirty || !!editor || !!inlineEdit || pendingInlineCount > 0 || busy || !creatorLoaded}
					onClick={() => setCreatorMode(true)}
					title="设计私有工作流，试运行后可申请在市场发布为 SkillBot。">
					✦ 创造模式
				</button>
				<span className="bw-separator" />
				<label className="bw-row-count">
					新增行数
					<input
						aria-label="新增行数"
						disabled={!rowControlsEnabled || taskCount >= 100}
						max={Math.max(1, 100 - taskCount)}
						min={1}
						onChange={(event) => setRowsToAdd(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
						type="number"
						value={rowsToAdd}
					/>
				</label>
				<button
					disabled={!rowControlsEnabled || rowsToAdd > 100 - taskCount}
					onClick={() => void addRows()}
					title="在末尾新增输入行；每行是一个独立任务。">
					＋ 新增行
				</button>
				<button
					disabled={!rowControlsEnabled || range.top < 1}
					onClick={askToDeleteRows}
					title="删除选区所在的视觉行，下面的行会上移；包含内容时会先确认。">
					删除选中行
				</button>
				<span className="bw-separator" />
				<button onClick={() => act({ action: "copy" })}>复制选区</button>
				<button disabled={!canEdit || pendingInlineCount > 0} onClick={() => openEditor()}>
					编辑单元格
				</button>
				<button
					disabled={busy || pendingInlineCount > 0 || formulaDirty || !!inlineEdit || !editable || range.top < 1}
					onClick={() =>
						void dispatchWithEditLease({
							action: "attach",
							sheet: sheet.id,
							range: view.range,
							revision: session.revision,
						}).catch(() => {})
					}
					title={
						!sheet.rows[range.top - 1]?.row.id
							? "可在此视觉行选择文件；文件绑定后才成为本批输入，运行前仍需检查和报价。"
							: undefined
					}>
					{inputFileMode === "text" ? "从文件导入文本" : inputFileMode === "asset" ? "上传素材" : "添加本地参考文件"}
				</button>
				<span className="bw-separator" />
				<button
					aria-pressed={(view.boldRanges ?? []).includes(view.range)}
					onClick={() => act({ action: "view", bold: !(view.boldRanges ?? []).includes(view.range) })}>
					<b>B</b>
				</button>
				<select
					aria-label="表格字号"
					onChange={(e) => changeView({ fontSize: Number(e.target.value) })}
					value={view.fontSize ?? 12}>
					{[11, 12, 13, 14, 15, 16].map((n) => (
						<option key={n}>{n}</option>
					))}
				</select>
				<button aria-pressed={!!view.wrap} onClick={() => changeView({ wrap: !view.wrap })}>
					自动换行
				</button>
				<button aria-pressed={view.freeze !== false} onClick={() => changeView({ freeze: view.freeze === false })}>
					冻结前两列
				</button>
				<button
					aria-pressed={view.gridlines !== false}
					onClick={() => changeView({ gridlines: view.gridlines === false })}>
					网格线
				</button>
				<span className="bw-spacer" />
				<input
					aria-label="查找单元格"
					onChange={(e) => setSearch(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") act({ action: "find", text: search })
					}}
					placeholder="查找内容"
					value={search}
				/>
				<button onClick={() => act({ action: "find", text: search })}>查找</button>
			</nav>
			<section aria-label="运行概况" className="bw-run">
				<div>
					<strong>
						{sheet.history ? "历史批次" : sheet.runId ? statusLabel(progress?.status ?? session.phase) : "输入准备"}
					</strong>
					{(sheet.history || sheet.runId) && (
						<span>{sheet.history ? effectiveTaskCount(sheet.history.rows) : taskCount} 条任务</span>
					)}
					<span className="bw-success">成功 {progress?.completed ?? 0}</span>
					<span className="bw-failure">失败 {progress?.failed ?? 0}</span>
					<span>取消 {progress?.cancelled ?? 0}</span>
					<span className="bw-spacer" />
					<button disabled={busy || !sheet.runId} onClick={() => act({ action: "refresh" })}>
						刷新进度
					</button>
					<button disabled={busy || !sheet.runId} onClick={() => act({ action: "save_outputs" })}>
						保存产物
					</button>
					<button className="bw-primary" disabled={!snapshot.editable} onClick={() => act({ action: "cite" })}>
						选区交给 Cline
					</button>
				</div>
				{progress && (
					<div className="bw-progress">
						<progress aria-label="整体批处理进度" max={Math.max(1, progress.total)} value={ended} />
						<span>
							{ended} / {progress.total} 已结束 · {pct}%
						</span>
					</div>
				)}
				<div className="bw-run-meta">
					<span>
						{sheet.runId
							? `Run ${sheet.runId}`
							: "单击选格后可直接输入；Enter 保存并下移，Tab 跳到下一个输入列，也可粘贴多行数据。空白视觉行不计入任务。"}
					</span>
					{sheet.runId && (
						<span>
							开始 {time(progress?.startedAt)}　结束 {time(progress?.completedAt)}　同步 {time(progress?.updatedAt)}
						</span>
					)}
				</div>
				<div className="bw-delivery">
					<span>
						产物保存至：<code title={shownOutputRoot}>{shownOutputRoot ?? "尚未选择项目目录"}</code>
					</span>
					<div>
						{!sheet.history && (
							<button
								disabled={busy || !snapshot.editable}
								onClick={() => void outputAction("chooseOutputDirectory")}>
								更改后续位置…
							</button>
						)}
						{sheet.runId && (
							<button disabled={busy} onClick={() => void outputAction("exportRunToDirectory", sheet.runId)}>
								另存本批…
							</button>
						)}
					</div>
				</div>
			</section>
			{!snapshot.editable && (
				<div className="bw-notice">
					此表关联另一条 Cline 任务，目前只读。
					<button
						onClick={() => {
							void LoomLoomServiceClient.batchTableAction(request({ taskId, action: "focusChat" })).catch((e) =>
								setError(message(e)),
							)
						}}>
						打开原对话
					</button>
				</div>
			)}
			{(error || session.error || sheet.history?.error) && (
				<div className="bw-error" role="alert">
					{error || sheet.history?.error || session.error}
					<button
						onClick={() => {
							setError("")
							setReconnect((n) => n + 1)
						}}>
						重新同步
					</button>
				</div>
			)}
			{editLeaseError && (
				<div className="bw-error" role="alert">
					{editLeaseError}。本地草稿会保留，保护恢复前不会提交此编辑。
					<button onClick={() => setEditLeaseRetry((attempt) => attempt + 1)}>重试编辑保护</button>
				</div>
			)}
			{Object.keys(failedInlineEdits).length > 0 && (
				<div className="bw-notice" role="alert">
					{Object.keys(failedInlineEdits).length} 个单元格草稿尚未确认保存。选择对应单元格可查看或复制； 若输入已被
					Cline 修改，请先复制草稿，按 Esc 放弃后重新编辑。检查输入和报价会等你处理完。
				</div>
			)}
			{formulaDirty && (
				<div className="bw-notice">
					{formulaTarget.address} 有未保存内容；切换单元格时会先保存，失败则保留草稿。
					<button
						onClick={() => {
							setFormulaDirty(false)
							setError("")
						}}>
						取消此次编辑
					</button>
				</div>
			)}
			<div className="bw-formula">
				<input
					aria-label="单元格地址"
					onChange={(e) => setAddressInput(e.target.value.toUpperCase())}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							try {
								parseRange(addressInput)
								changeView({ range: addressInput })
							} catch (err) {
								setError(message(err))
							}
						}
					}}
					readOnly={formulaDirty}
					value={formulaDirty ? formulaTarget.address : addressInput}
				/>
				<span className="bw-fx">fx</span>
				<input
					aria-label="单元格内容"
					onChange={(e) => {
						if (!formulaDirty) {
							void ensureEditLease().catch(() => {})
							setFormulaTarget({ sheet: sheet.id, address: cellAddress })
							setFormulaRevision(session.revision)
						}
						setFormula(e.target.value)
						setFormulaDirty(true)
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault()
							void saveFormula(true)
						}
						if (e.key === "Escape") {
							setFormula(selectedValue)
							setFormulaDirty(false)
							setError("")
						}
					}}
					readOnly={busy || pendingInlineCount > 0 || !!inlineEdit || (formulaDirty ? !formulaWritable : !textEditable)}
					value={formula}
				/>
				<button disabled={!formulaWritable || !formulaDirty || busy} onClick={() => void saveFormula()}>
					✓
				</button>
				<button onClick={() => openEditor()}>展开</button>
			</div>
			<div
				aria-colcount={cols.length}
				aria-label="Batch 电子表格"
				aria-rowcount={rowCount + 1}
				className="bw-grid-viewport"
				onKeyDown={keyboard}
				onPaste={(e) => {
					if (e.target !== e.currentTarget) return
					e.preventDefault()
					pasteGridText(e.clipboardData.getData("text/plain"))
				}}
				ref={gridRef}
				role="grid"
				tabIndex={0}>
				<table
					className={`bw-grid ${view.wrap ? "wrap" : ""} ${view.gridlines === false ? "no-lines" : ""}`}
					style={{ width: 42 + cols.reduce((n, _, i) => n + width(i), 0) }}>
					<colgroup>
						<col style={{ width: 42 }} />
						{cols.map((col, i) => (
							<col key={col.key} style={{ width: width(i) }} />
						))}
					</colgroup>
					<thead>
						<tr>
							<th aria-label="行号" className="bw-corner" />
							{cols.map((col, i) => (
								<th
									className={i >= range.left && i <= range.right ? "active-letter" : ""}
									key={col.key}
									scope="col"
									style={{ ...frozen(i), zIndex: i < 2 && view.freeze !== false ? 6 : 3 }}>
									<button
										aria-label={`选择 ${columnLetter(i)} 列`}
										onClick={() =>
											changeView({ range: selectionAddress(0, i, Math.max(1, sheet.rows.length), i) })
										}>
										{columnLetter(i)}
									</button>
									<button
										aria-label={`调整 ${columnLetter(i)} 列宽`}
										className="bw-resize"
										onKeyDown={(e) => {
											if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
												e.preventDefault()
												changeView({
													columnWidths: {
														...view.columnWidths,
														[columnLetter(i)]: Math.max(
															55,
															Math.min(640, width(i) + (e.key === "ArrowRight" ? 10 : -10)),
														),
													},
												})
											}
										}}
										onPointerDown={(e) => {
											e.preventDefault()
											resizeCleanup.current?.()
											const x = e.clientX,
												start = width(i)
											let nextWidth = start
											const move = (event: PointerEvent) => {
												nextWidth = Math.min(
													640,
													Math.max(55, start + (event.clientX - x) / ((view.zoom ?? 100) / 100)),
												)
												setLocalView({
													...view,
													columnWidths: { ...view.columnWidths, [columnLetter(i)]: nextWidth },
												})
											}
											const cleanup = () => {
												window.removeEventListener("pointermove", move)
												window.removeEventListener("pointerup", end)
												resizeCleanup.current = null
											}
											const end = () => {
												cleanup()
												changeView({
													columnWidths: { ...view.columnWidths, [columnLetter(i)]: nextWidth },
												})
											}
											resizeCleanup.current = cleanup
											window.addEventListener("pointermove", move)
											window.addEventListener("pointerup", end)
										}}
									/>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{[0, ...visibleRows.rows].map((row) => (
							<Fragment key={row}>
								{row === visibleRows.first + 1 && visibleRows.first > 0 && (
									<tr aria-hidden="true" className="bw-spacer-row">
										<td
											colSpan={cols.length + 1}
											style={{
												height: visibleRows.first * (view.wrap ? WRAPPED_ROW_HEIGHT : GRID_ROW_HEIGHT),
											}}
										/>
									</tr>
								)}
								<tr aria-rowindex={row + 1} className={row === 0 ? "bw-field-row" : ""} key={row}>
									<th className={row >= range.top && row <= range.bottom ? "active-letter" : ""} scope="row">
										<button
											aria-label={`选择第 ${row + 1} 行`}
											onClick={() => changeView({ range: selectionAddress(row, 0, row, cols.length - 1) })}>
											{row + 1}
										</button>
									</th>
									{cols.map((col, colIndex) => {
										const address = selectionAddress(row, colIndex)
										const localFile =
											col.kind === "output" && row > 0
												? localOutputs.get(
														`${sheet.runId}:${sheet.rows[row - 1]?.sourceIndex}:${col.outputIndex ?? 0}`,
													)
												: undefined
										const value = pendingInlineEdits[address]
												? pendingInlineEdits[address].value
												: localFile?.status === "saved"
													? `${localFile.relativePath?.split(/[\\/]/).at(-1) || "本地文件"} · 已保存`
													: localFile?.status === "error"
														? `${sheetValue(sheet, row, colIndex)} · 本地保存失败`
														: sheetValue(sheet, row, colIndex),
											isSelected = selected(row, colIndex),
											active = row === range.top && colIndex === range.left
										const editingHere = inlineEdit?.address === address && inlineEdit.sheet === sheet.id
										const captureHere = active && editable && row > 0 && isInlineTextField(col.field)
										const status = sheet.rows[row - 1]?.status.toLowerCase()
										const outputMime =
											col.kind === "output" && row > 0
												? (
														localFile?.mimeType ??
														sheet.rows[row - 1]?.artifacts[col.outputIndex ?? 0]?.mimeType
													)
														?.split(";", 1)[0]
														?.trim()
														.toLowerCase()
												: undefined
										const mediaOutput = !!outputMime && MEDIA_PREVIEW_MIMES.has(outputMime)
										return (
											<td
												aria-label={`${columnLetter(colIndex)}${row + 1} ${row === 0 ? col.label : ""}`}
												aria-selected={isSelected}
												className={`${isSelected ? "selected" : ""} ${active ? "active-cell" : ""} ${editingHere ? "editing-cell" : ""} ${failedInlineEdits[address] ? "unsaved-cell" : ""} ${mediaOutput ? "media-output-cell" : ""} ${col.kind === "status" ? `status-${status}` : ""}`}
												data-address={address}
												key={col.key}
												onClick={(e) => {
													if (e.target !== e.currentTarget && editingHere) return
													if (suppressDragClick.current) {
														suppressDragClick.current = false
														return
													}
													if (viewRef.current.range !== address || e.shiftKey)
														select(row, colIndex, e.shiftKey)
													gridRef.current?.focus({ preventScroll: true })
												}}
												onDoubleClick={() => beginCellEdit(row, colIndex)}
												onMouseDown={(event) => {
													if (event.button !== 0 || editingHere) return
													dragSelection.current = { moved: false }
													select(row, colIndex, event.shiftKey)
													gridRef.current?.focus({ preventScroll: true })
												}}
												onMouseEnter={() => {
													if (!dragSelection.current) return
													dragSelection.current.moved = true
													select(row, colIndex, true)
												}}
												role="gridcell"
												style={{
													...frozen(colIndex),
													fontWeight: boldRanges.some(
														(r) =>
															row >= r.top &&
															row <= r.bottom &&
															colIndex >= r.left &&
															colIndex <= r.right,
													)
														? 700
														: undefined,
												}}
												title={
													mediaOutput
														? "点击预览图片或视频"
														: value.length > 220
															? `${value.slice(0, 220)}…（双击查看完整内容）`
															: value
												}>
												{!editingHere &&
													(row > 0 && col.kind === "progress" && value === "100%" ? (
														<span className="bw-cell-progress">
															<i />
															100%
														</span>
													) : (
														<span className="bw-cell-text">
															{value.length > 240 ? `${value.slice(0, 240)}…` : value}
														</span>
													))}
												{mediaOutput && !editingHere && (
													<button
														aria-label={`预览 ${address} 媒体产物`}
														className="bw-cell-preview"
														onClick={(event) => {
															event.stopPropagation()
															openEditor(row, colIndex)
														}}
														onDoubleClick={(event) => event.stopPropagation()}>
														预览
													</button>
												)}
												{(editingHere || captureHere) && (
													<textarea
														aria-label={editingHere ? `${address} 格内编辑` : `${address} 键盘输入`}
														className={editingHere ? "bw-inline-editor" : "bw-cell-keyboard-capture"}
														key="cell-entry"
														onBeforeInput={(event) => {
															if (editingHere) return
															const native = event.nativeEvent as InputEvent
															if (native.isComposing || native.inputType?.includes("Composition")) {
																composing.current = true
																beginCellEdit(row, colIndex, event.currentTarget.value)
															} else if (native.inputType === "insertText" && native.data) {
																event.preventDefault()
																beginCellEdit(row, colIndex, native.data)
															}
														}}
														onBlur={() => {
															if (editingHere && !composing.current) commitInline()
														}}
														onChange={(event) => {
															if (editingHere)
																setInlineEdit((current) =>
																	current ? { ...current, value: event.target.value } : current,
																)
															else if (event.target.value)
																beginCellEdit(row, colIndex, event.target.value)
														}}
														onClick={(event) => {
															if (editingHere) event.stopPropagation()
														}}
														onCompositionEnd={(event) => {
															const committed = event.currentTarget.value
															composing.current = false
															justFinishedComposition.current = true
															if (compositionTimer.current !== undefined)
																window.clearTimeout(compositionTimer.current)
															compositionTimer.current = window.setTimeout(() => {
																justFinishedComposition.current = false
															}, 0)
															setInlineEdit((current) =>
																current?.address === address
																	? { ...current, value: committed }
																	: current,
															)
														}}
														onCompositionStart={(event) => {
															composing.current = true
															justFinishedComposition.current = false
															if (!editingHere)
																beginCellEdit(row, colIndex, event.currentTarget.value)
														}}
														onDoubleClick={(event) => {
															if (editingHere) event.stopPropagation()
														}}
														onInput={(event) => {
															if (!editingHere && event.currentTarget.value)
																beginCellEdit(row, colIndex, event.currentTarget.value)
														}}
														onKeyDown={(event) => {
															event.stopPropagation()
															if (!editingHere) {
																keyboard(event, true)
																return
															}
															if (composing.current || event.nativeEvent.isComposing) return
															if (justFinishedComposition.current && event.key === "Enter") {
																event.preventDefault()
																return
															}
															if (event.key === "Escape") {
																event.preventDefault()
																inlineClosing.current = true
																setInlineEdit(null)
																setFailedInlineEdits((current) => {
																	if (!current[address]) return current
																	const next = { ...current }
																	delete next[address]
																	return next
																})
																gridRef.current?.focus({ preventScroll: true })
															} else if (event.key === "Enter" && !event.altKey) {
																event.preventDefault()
																commitInline({
																	row: Math.max(
																		1,
																		Math.min(rowCount, row + (event.shiftKey ? -1 : 1)),
																	),
																	col: colIndex,
																})
																gridRef.current?.focus({ preventScroll: true })
															} else if (event.key === "Tab") {
																event.preventDefault()
																commitInline(nextInputCell(row, colIndex, event.shiftKey))
																gridRef.current?.focus({ preventScroll: true })
															}
														}}
														onPaste={(event) => {
															if (!editingHere) {
																event.preventDefault()
																event.stopPropagation()
																pasteGridText(event.clipboardData.getData("text/plain"))
															}
														}}
														ref={editingHere ? inlineInputRef : keyboardCaptureRef}
														rows={1}
														tabIndex={editingHere ? 0 : -1}
														value={editingHere ? inlineEdit.value : ""}
													/>
												)}
											</td>
										)
									})}
								</tr>
							</Fragment>
						))}
						{visibleRows.end < rowCount && (
							<tr aria-hidden="true" className="bw-spacer-row">
								<td
									colSpan={cols.length + 1}
									style={{
										height: (rowCount - visibleRows.end) * (view.wrap ? WRAPPED_ROW_HEIGHT : GRID_ROW_HEIGHT),
									}}
								/>
							</tr>
						)}
					</tbody>
				</table>
			</div>
			<footer className="bw-footer">
				<nav aria-label="工作表" className="bw-tabs">
					{listSheets(session).map((tab) => (
						<button
							aria-pressed={sheet.id === tab.id}
							key={tab.id}
							onClick={() => changeView({ sheet: tab.id, range: tab.id === "progress" ? "B2" : "C2" })}
							title={tab.runId}>
							{tab.title}
						</button>
					))}
				</nav>
				<span className="bw-spacer" />
				<label>
					缩放{" "}
					<select
						aria-label="表格缩放"
						onChange={(e) => changeView({ zoom: Number(e.target.value) })}
						value={view.zoom ?? 100}>
						{[80, 90, 100, 110, 120, 130].map((n) => (
							<option key={n} value={n}>
								{n}%
							</option>
						))}
					</select>
				</label>
			</footer>
			<div className="bw-status">
				<span>
					{editable ? "可编辑输入" : "只读"} · {view.range} ·{" "}
					{(range.bottom - range.top + 1) * (range.right - range.left + 1)} 个单元格
					{selectedVisualBlank && editable ? " · 空白视觉行，输入后才创建任务" : ""}
				</span>
				<span>
					{pendingInlineCount > 0
						? `正在保存 ${pendingInlineCount} 个单元格…`
						: busy
							? "正在处理…"
							: "与左侧 Batch Agent 共享状态"}
				</span>
			</div>
			{editor && editorSheet && (
				<div
					className="bw-overlay"
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							setEditor(null)
							gridRef.current?.focus()
						}
						if (e.key === "Tab") {
							const elements = dialogRef.current?.querySelectorAll<HTMLElement>(
								"button:not(:disabled),input:not(:disabled),textarea,select",
							)
							if (!elements?.length) return
							const first = elements[0],
								last = elements[elements.length - 1]
							if (
								e.shiftKey &&
								(document.activeElement === first || document.activeElement === dialogRef.current)
							) {
								e.preventDefault()
								last.focus()
							} else if (!e.shiftKey && document.activeElement === last) {
								e.preventDefault()
								first.focus()
							}
						}
					}}>
					<div
						aria-label={`${editor.address} 单元格详情`}
						aria-modal="true"
						className="bw-dialog batch-ui"
						ref={dialogRef}
						role="dialog"
						tabIndex={-1}>
						<header>
							<strong>
								{editor.address} · {editorSheet.columns[editor.col]?.label}
							</strong>
							<button
								aria-label="关闭单元格详情"
								onClick={() => {
									setEditor(null)
									gridRef.current?.focus()
								}}>
								×
							</button>
						</header>
						{editorWritable && editorField ? (
							<BatchFieldEditor
								field={editorField}
								onChange={(value) => setEditor({ ...editor, value })}
								taskId={taskId}
								value={editor.value}
							/>
						) : previewKey ? (
							<div aria-label="媒体产物预览" className="bw-media-preview">
								{(!mediaPreview || mediaPreview.key !== previewKey || mediaPreview.status === "loading") && (
									<p role="status">正在准备本地预览…</p>
								)}
								{mediaPreview?.key === previewKey && mediaPreview.status === "ready" && mediaPreview.uri && (
									<>
										{!mediaLoaded && <p role="status">正在载入媒体…</p>}
										{mediaPreview.mimeType?.startsWith("image/") ? (
											<img
												alt={previewArtifact?.portName || "Batch 图片产物"}
												onError={() =>
													setMediaPreview({
														key: previewKey,
														status: "error",
														error: "图片无法解码或本地文件已变化。",
													})
												}
												onLoad={() => setMediaLoaded(true)}
												src={mediaPreview.uri}
											/>
										) : (
											<video
												aria-label="Batch 视频产物"
												controls
												onError={() =>
													setMediaPreview({
														key: previewKey,
														status: "error",
														error: "视频无法解码或本地文件已变化。",
													})
												}
												onLoadedMetadata={() => setMediaLoaded(true)}
												playsInline
												preload="metadata"
												src={mediaPreview.uri}
											/>
										)}
										{mediaPreview.relativePath && <small>已保存：{mediaPreview.relativePath}</small>}
									</>
								)}
								{mediaPreview?.key === previewKey && mediaPreview.status === "error" && (
									<div role="alert">
										<p>{mediaPreview.error || "暂时无法预览；云端结果仍可在本批记录中查看。"}</p>
										<button onClick={() => setPreviewRetry((retry) => retry + 1)}>重试预览</button>
									</div>
								)}
							</div>
						) : (
							<pre>{String(editor.value) || "暂无内容"}</pre>
						)}
						{editorRow?.row.attachments.map((file) => (
							<div className="bw-attachment" key={file.id}>
								<span>
									▣ {file.name}
									{file.mode === "text"
										? " · 已导入文本"
										: file.mode === "asset" || !!file.inputAssetId
											? " · 云端素材"
											: " · 本地参考"}
								</span>
								{editable && !editorBlank && (editorFileMode === "text" || editorFileMode === "asset") && (
									<button
										disabled={busy || editorDirty}
										onClick={() => {
											void dispatchWithEditLease({
												action: "import_reference",
												sheet: editor.sheet,
												range: editor.address,
												revision: session.revision,
												attachmentId: file.id,
											})
												.then(() => setEditor(null))
												.catch(() => {})
										}}>
										用于此输入
									</button>
								)}
								{editable && !editorBlank && (
									<button
										disabled={busy}
										onClick={() => {
											void dispatchWithEditLease({
												action: "remove_attachment",
												sheet: editor.sheet,
												range: editor.address,
												revision: session.revision,
												attachmentId: file.id,
											})
												.then(() => setEditor(null))
												.catch(() => {})
										}}>
										移除
									</button>
								)}
							</div>
						))}
						{editorStale && editorWritable && (
							<p role="alert">输入已被更新，请保留文本并重新打开单元格。不会覆盖另一端的修改。</p>
						)}
						<div className="batch-actions">
							<button onClick={() => act({ action: "copy", sheet: editor.sheet, range: editor.address })}>
								复制单元格
							</button>
							<button
								disabled={!snapshot.editable}
								onClick={() => act({ action: "cite", sheet: editor.sheet, range: editor.address })}>
								交给 Cline
							</button>
							{(editorFileMode === "asset" || editorFileMode === "text") && editable && (
								<button
									disabled={busy || editorDirty}
									onClick={() => {
										void dispatchWithEditLease({
											action: "attach",
											sheet: editor.sheet,
											range: editor.address,
											revision: session.revision,
										})
											.then(() => setEditor(null))
											.catch(() => {})
									}}>
									{editorFileMode === "text" ? "从文件导入文本" : "上传素材"}
								</button>
							)}
							{editorSheet.columns[editor.col]?.kind === "output" && (
								<button
									onClick={() => act({ action: "open_output", sheet: editor.sheet, range: editor.address })}>
									{previewKey
										? editorFile?.status === "saved"
											? "在编辑器中打开本地媒体"
											: "在外部查看云端产物"
										: editorFile?.status === "saved"
											? "打开本地文件"
											: "保存并打开 / 查看产物"}
								</button>
							)}
							{editorWritable && (
								<button
									className="primary"
									disabled={busy || editorStale}
									onClick={() => {
										void dispatchWithEditLease({
											action: "write",
											sheet: editor.sheet,
											range: editor.address,
											revision: editor.revision,
											values: [[editor.value]],
										})
											.then(() => setEditor(null))
											.catch(() => {})
									}}>
									保存到工作表
								</button>
							)}
						</div>
						{editorFile?.status === "saved" && <p className="bw-run-meta">已保存：{editorFile.relativePath}</p>}
						{editorFile?.status === "error" && <p role="alert">云端结果已保留，本地保存失败：{editorFile.error}</p>}
						{editorBlank && (editorFileMode === "text" || editorFileMode === "asset") && editable && (
							<small>可直接在这一视觉行选择文件；成功绑定后该行才成为本批输入，运行前仍需检查和报价。</small>
						)}
						{editorFileMode === "text" && editable && !editorBlank && (
							<small>导入文件正文会替换此字段；内容会随报价和运行发送到 LoomLoom。请先保存未提交的编辑。</small>
						)}
						{error && <p role="alert">{error}</p>}
					</div>
				</div>
			)}
			{pendingDelete && (
				<div className="bw-overlay" onKeyDown={(event) => event.key === "Escape" && setPendingDelete(null)}>
					<div
						aria-label="删除输入行"
						aria-modal="true"
						className="bw-dialog bw-delete-dialog"
						role="alertdialog"
						tabIndex={-1}>
						<header>
							<strong>删除 {pendingDelete.count} 条视觉行？</strong>
						</header>
						<p>
							{pendingDelete.filled > 0 || pendingDelete.files > 0
								? `其中 ${pendingDelete.filled} 行已填写、${pendingDelete.files} 个文件已附加。删除后无法恢复。`
								: "这些空行将从当前批次移除。"}
						</p>
						{session.revision !== pendingDelete.revision && <p role="alert">输入已更新，请取消后重新选择行。</p>}
						{session.quote && <p>当前预算将失效，需要重新检查输入和报价。</p>}
						<div className="batch-actions">
							<button onClick={() => setPendingDelete(null)}>取消</button>
							<button
								className="bw-danger"
								disabled={!rowControlsEnabled || session.revision !== pendingDelete.revision}
								onClick={() => void deleteRows(pendingDelete, true)}>
								确认删除
							</button>
						</div>
					</div>
				</div>
			)}
		</main>
	)
}
