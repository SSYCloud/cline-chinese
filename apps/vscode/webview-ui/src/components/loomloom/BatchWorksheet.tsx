import type { BatchCommand, BatchSession, BatchTableSnapshot, BatchValue, BatchWorksheetView } from "@shared/loomloom"
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
import { getWebviewState, setWebviewState } from "@/config/platform.config"
import { LoomLoomServiceClient } from "@/services/grpc-client"
import { BatchFieldEditor } from "./BatchFieldEditor"
import { BatchRunControls } from "./BatchRunControls"
import { sendBatch } from "./batch-api"
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
type WorksheetDraft = {
	version: 1
	taskId: string
	formula?: { value: string; revision: number; target: { sheet: string; address: string } }
	editor?: WorksheetEditor
	surface?: "sheet" | "creator"
	creator?: CreatorDraft
	creatorLocalAt?: number
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
	rowIds: string[]
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
	}
}

/** A view onto the existing task, with no chat provider, model or independent draft store. */
export function BatchWorksheet({ taskId }: { taskId: string }) {
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
		dialogRef = useRef<HTMLDivElement>(null)
	const lastSelectionScroll = useRef("")
	const anchor = useRef({ row: 1, col: 2 })
	const requests = useRef(Promise.resolve<unknown>(undefined))
	const viewRequest = useRef(0)
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
			surface: creatorMode ? "creator" : "sheet",
			creator: creatorLoaded ? creatorDraft : undefined,
			creatorLocalAt: creatorLoaded ? creatorLocalAt.current : undefined,
		}
		if (draftTimer.current !== undefined) window.clearTimeout(draftTimer.current)
		draftTimer.current = window.setTimeout(() => {
			setWebviewState(draftRef.current)
			draftTimer.current = undefined
		}, 300)
	}, [taskId, formula, formulaDirty, formulaRevision, formulaTarget, editor, creatorMode, creatorDraft, creatorLoaded])
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
		lastSelectionScroll.current = ""
		setLocalView(null)
		setHostView(null)
	}, [taskId])
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
	useEffect(() => {
		setRowsToAdd((count) => Math.min(count, Math.max(1, 100 - (session?.rows.length ?? 0))))
	}, [session?.rows.length])
	const view = localView ?? hostView ?? session?.worksheet ?? { sheet: "current", range: "C2" }
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
	const rowCount = Math.max(31, sheet?.rows.length ?? 0)
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
	const editable = !!snapshot?.editable && !!sheet && !sheet.readOnly
	const rowControlsEnabled =
		editable && !!session?.listing && sheet?.id === "current" && !busy && !formulaDirty && !editor && connection === "已同步"
	const selectedInputRows = useMemo(
		() => (sheet && range.top >= 1 && range.bottom <= sheet.rows.length ? sheet.rows.slice(range.top - 1, range.bottom) : []),
		[sheet, range.top, range.bottom],
	)
	const field = sheet?.columns[range.left]?.field
	const inputFileMode = getBatchFileInputMode(field)
	const canEdit =
		editable && range.top > 0 && range.top <= (sheet?.rows.length ?? 0) && !!field && field.value_type !== "asset_ref"
	const textEditable =
		canEdit &&
		!field?.enum_values?.length &&
		field?.value_type !== "boolean" &&
		!field?.model_override &&
		!/model|模型/i.test((field?.key ?? "") + (field?.label ?? ""))
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
	const dispatch = useCallback(
		(operation: Record<string, unknown>, quiet = false) => {
			if (!quiet) {
				setBusy(true)
				setError("")
			}
			const next = requests.current
				.catch(() => {})
				.then(async () => {
					const result = await LoomLoomServiceClient.worksheetOperation(request({ taskId, operation }))
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
	async function runCommand(command: BatchCommand): Promise<BatchSession | null> {
		// Finish pending worksheet RPCs first. The captured revision/quote still has
		// to match on the host, so a newer edit can never be silently approved.
		if (
			busy ||
			formulaDirty ||
			editor ||
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
		if (!rowControlsEnabled || !session || !sheet || rowsToAdd > 100 - sheet.rows.length) return
		const firstNewRow = sheet.rows.length + 1
		const updated = await runCommand({ action: "addRows", revision: session.revision, count: rowsToAdd })
		if (updated) changeView({ sheet: "current", range: selectionAddress(firstNewRow, 2) })
	}
	function askToDeleteRows() {
		if (!rowControlsEnabled || !session || !selectedInputRows.length) return
		setPendingDelete({
			revision: session.revision,
			rowIds: selectedInputRows.map((item) => item.row.id),
			top: range.top,
			filled: selectedInputRows.filter((item) =>
				Object.values(item.row.values).some((value) => value !== "" && value !== null && value !== undefined),
			).length,
			files: selectedInputRows.reduce((sum, item) => sum + item.row.attachments.length, 0),
		})
	}
	async function deleteRows() {
		if (!pendingDelete || !rowControlsEnabled || !session || session.revision !== pendingDelete.revision) return
		const deleted = pendingDelete
		const updated = await runCommand({ action: "removeRows", revision: deleted.revision, rowIds: deleted.rowIds })
		if (!updated) return
		setPendingDelete(null)
		changeView({ sheet: "current", range: selectionAddress(Math.max(1, Math.min(deleted.top, updated.rows.length)), 2) })
	}
	function changeView(patch: Partial<BatchWorksheetView>) {
		if (formulaDirty && (patch.range !== undefined || patch.sheet !== undefined)) {
			setError(`${formulaTarget.address} 有未保存内容，请先按 Enter 保存或按 Esc 取消。`)
			return
		}
		const next = { ...view, ...patch }
		const requestId = ++viewRequest.current
		setLocalView(next)
		void dispatch({ action: "view", sheet: next.sheet, range: next.range, ...patch }, true)
			.then((saved: BatchWorksheetView) => {
				if (viewRequest.current === requestId && saved?.sheet && saved?.range) setHostView(saved)
			})
			.catch(() => {})
			.finally(() => {
				if (viewRequest.current === requestId) setLocalView(null)
			})
	}
	function select(row: number, col: number, extend = false) {
		if (!sheet) return
		row = Math.max(0, Math.min(row, Math.max(31, sheet.rows.length)))
		col = Math.max(0, Math.min(col, sheet.columns.length - 1))
		if (!extend) anchor.current = { row, col }
		changeView({
			range: selectionAddress(
				Math.min(row, anchor.current.row),
				Math.min(col, anchor.current.col),
				Math.max(row, anchor.current.row),
				Math.max(col, anchor.current.col),
			),
		})
	}
	function openEditor(row = range.top, col = range.left) {
		if (formulaDirty) {
			setError(`${formulaTarget.address} 有未保存内容，请先保存或取消。`)
			return
		}
		if (!sheet || !session || row < 1 || row > sheet.rows.length) return
		const address = selectionAddress(row, col),
			f = sheet.columns[col]?.field
		setEditor({
			address,
			sheet: sheet.id,
			row,
			col,
			revision: session.revision,
			value: f ? (sheet.rows[row - 1].row.values[f.key] ?? "") : sheetValue(sheet, row, col, true),
		})
	}
	async function saveFormula() {
		if (!formulaDirty || !formulaWritable || busy) return
		try {
			await dispatch({
				action: "write",
				sheet: formulaTarget.sheet,
				range: formulaTarget.address,
				revision: formulaRevision,
				values: [[formula]],
			})
			setFormulaDirty(false)
		} catch {
			/* Preserve unsaved text. */
		}
	}
	function keyboard(e: KeyboardEvent<HTMLDivElement>) {
		if (e.target !== e.currentTarget) return
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
			Tab: [0, e.shiftKey ? -1 : 1],
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
		if (e.key === "Enter" || e.key === "F2") {
			e.preventDefault()
			openEditor()
		}
		if (e.key === "Delete" && editable) {
			e.preventDefault()
			act({
				action: "write",
				revision: session?.revision,
				values: Array.from({ length: range.bottom - range.top + 1 }, () => Array(range.right - range.left + 1).fill("")),
			})
		}
	}
	const boldRanges = useMemo(() => (view.boldRanges ?? []).map(parseRange), [view.boldRanges])
	const localOutputs = useMemo(
		() =>
			new Map((session?.localOutputs ?? []).map((file) => [`${file.runId}:${file.rowIndex}:${file.artifactIndex}`, file])),
		[session?.localOutputs],
	)
	const editorSheet = useMemo(() => (session && editor ? buildSheet(session, editor.sheet) : null), [session, editor?.sheet])
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
					disabled={formulaDirty || !!editor || busy || !creatorLoaded}
					onClick={() => setCreatorMode(true)}
					title="设计私有工作流，试运行后可申请在市场发布为 SkillBot。">
					✦ 创造模式
				</button>
				<span className="bw-separator" />
				<label className="bw-row-count">
					新增行数
					<input
						aria-label="新增行数"
						disabled={!rowControlsEnabled || sheet.rows.length >= 100}
						max={Math.max(1, 100 - sheet.rows.length)}
						min={1}
						onChange={(event) => setRowsToAdd(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
						type="number"
						value={rowsToAdd}
					/>
				</label>
				<button
					disabled={!rowControlsEnabled || rowsToAdd > 100 - sheet.rows.length}
					onClick={() => void addRows()}
					title="在末尾新增输入行；每行是一个独立任务。">
					＋ 新增行
				</button>
				<button
					disabled={!rowControlsEnabled || !selectedInputRows.length}
					onClick={askToDeleteRows}
					title="先选中一行或连续多行，再删除这些输入行。">
					删除选中行
				</button>
				<span className="bw-separator" />
				<button onClick={() => act({ action: "copy" })}>复制选区</button>
				<button disabled={!canEdit} onClick={() => openEditor()}>
					编辑单元格
				</button>
				<button
					disabled={busy || formulaDirty || !editable || range.top < 1 || range.top > sheet.rows.length}
					onClick={() => act({ action: "attach", revision: session.revision })}>
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
					<span>{sheet.rows.length} 条任务</span>
					<span className="bw-success">成功 {progress?.completed ?? 0}</span>
					<span className="bw-failure">失败 {progress?.failed ?? 0}</span>
					<span>取消 {progress?.cancelled ?? 0}</span>
					<span className="bw-spacer" />
					<button disabled={busy || !sheet.runId} onClick={() => act({ action: "refresh" })}>
						刷新进度
					</button>
					<button disabled={busy || !sheet.runId} onClick={() => act({ action: "save_outputs" })}>
						保存文本产物
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
							: "可随时新增或删除行；双击单元格编辑，粘贴支持多行多列，也可让 Cline 整理输入。"}
					</span>
					{sheet.runId && (
						<span>
							开始 {time(progress?.startedAt)}　结束 {time(progress?.completedAt)}　同步 {time(progress?.updatedAt)}
						</span>
					)}
				</div>
			</section>
			{!sheet.history && session.enabled && (
				<div className="bw-workflow">
					<BatchRunControls
						disabled={busy || formulaDirty || !!editor || !snapshot.editable || connection !== "已同步"}
						onCommand={runCommand}
						session={session}
						showGuidance
					/>
				</div>
			)}
			{sheet.history && (
				<div className="bw-notice">
					正在查看历史批次，不会操作当前输入或重复生成。
					<button onClick={() => changeView({ sheet: "current", range: "C2" })}>返回本批工作表</button>
				</div>
			)}
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
			{snapshot.editable && !session.enabled && (
				<div className="bw-notice">
					当前对话已退出 Batch，输入保留为只读。切回 Batch 后可继续编辑；已提交任务仍会更新进度。
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
			{formulaDirty && (
				<div className="bw-notice">
					{formulaTarget.address} 有未保存内容。
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
							setFormulaTarget({ sheet: sheet.id, address: cellAddress })
							setFormulaRevision(session.revision)
						}
						setFormula(e.target.value)
						setFormulaDirty(true)
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") void saveFormula()
						if (e.key === "Escape") {
							setFormula(selectedValue)
							setFormulaDirty(false)
							setError("")
						}
					}}
					readOnly={busy || (formulaDirty ? !formulaWritable : !textEditable)}
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
					if (formulaDirty) {
						setError(`${formulaTarget.address} 有未保存内容，请先保存或取消。`)
						return
					}
					try {
						act({
							action: "write",
							revision: session.revision,
							values: parseTsv(e.clipboardData.getData("text/plain")),
						})
					} catch (err) {
						setError(message(err))
					}
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
										const localFile =
											col.kind === "output" && row > 0
												? localOutputs.get(
														`${sheet.runId}:${sheet.rows[row - 1]?.sourceIndex}:${col.outputIndex ?? 0}`,
													)
												: undefined
										const value =
												localFile?.status === "saved"
													? `${localFile.relativePath?.split(/[\\/]/).at(-1) || "本地文件"} · 已保存`
													: localFile?.status === "error"
														? `${sheetValue(sheet, row, colIndex)} · 本地保存失败`
														: sheetValue(sheet, row, colIndex),
											isSelected = selected(row, colIndex),
											active = row === range.top && colIndex === range.left
										const status = sheet.rows[row - 1]?.status.toLowerCase()
										return (
											<td
												aria-label={`${columnLetter(colIndex)}${row + 1} ${row === 0 ? col.label : ""}`}
												aria-selected={isSelected}
												className={`${isSelected ? "selected" : ""} ${active ? "active-cell" : ""} ${col.kind === "status" ? `status-${status}` : ""}`}
												data-address={selectionAddress(row, colIndex)}
												key={col.key}
												onClick={(e) => {
													select(row, colIndex, e.shiftKey)
													gridRef.current?.focus({ preventScroll: true })
												}}
												onDoubleClick={() => openEditor(row, colIndex)}
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
													value.length > 220 ? `${value.slice(0, 220)}…（双击查看完整内容）` : value
												}>
												{row > 0 && col.kind === "progress" && value === "100%" ? (
													<span className="bw-cell-progress">
														<i />
														100%
													</span>
												) : (
													<span className="bw-cell-text">
														{value.length > 240 ? `${value.slice(0, 240)}…` : value}
													</span>
												)}
												{active && <i className="bw-selection-handle" />}
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
				</span>
				<span>{busy ? "正在处理…" : "与左侧 Batch Agent 共享状态"}</span>
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
								{editable && (editorFileMode === "text" || editorFileMode === "asset") && (
									<button
										disabled={busy || editorDirty}
										onClick={() => {
											void dispatch({
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
								{editable && (
									<button
										disabled={busy}
										onClick={() => {
											void dispatch({
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
										void dispatch({
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
									{editorFile?.status === "saved" ? "打开本地文件" : "保存并打开 / 查看产物"}
								</button>
							)}
							{editorWritable && (
								<button
									className="primary"
									disabled={busy || editorStale}
									onClick={() => {
										void dispatch({
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
						{editorFileMode === "text" && editable && (
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
							<strong>删除 {pendingDelete.rowIds.length} 条输入行？</strong>
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
								onClick={() => void deleteRows()}>
								确认删除
							</button>
						</div>
					</div>
				</div>
			)}
		</main>
	)
}
