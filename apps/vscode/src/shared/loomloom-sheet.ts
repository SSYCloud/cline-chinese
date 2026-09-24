import type { BatchArtifact, BatchField, BatchHistoryRun, BatchRow, BatchSession, BatchValue } from "./loomloom"
import { resolveBatchModelField } from "./loomloom-models"

export interface SheetColumn {
	key: string
	label: string
	kind: "id" | "status" | "input" | "progress" | "output" | "error" | "taskId"
	width: number
	field?: BatchField
	outputIndex?: number
}
export interface SheetRow {
	sourceIndex: number
	row: BatchRow
	status: string
	artifacts: BatchArtifact[]
	error: string
	taskId: string
}
export interface BatchSheet {
	id: string
	title: string
	history?: BatchHistoryRun
	columns: SheetColumn[]
	rows: SheetRow[]
	readOnly: boolean
	runId?: string
}
const finished = new Set(["completed", "succeeded", "success", "failed", "cancelled", "canceled"])
export function statusLabel(status: string) {
	return (
		(
			{
				completed: "已完成",
				succeeded: "已完成",
				success: "已完成",
				running: "执行中",
				processing: "执行中",
				in_progress: "执行中",
				queued: "等待中",
				pending: "等待中",
				submitted: "已提交",
				failed: "失败",
				cancelled: "已取消",
				canceled: "已取消",
				draft: "待确认",
				unknown: "等待同步",
				partially_failed: "部分失败",
				partial_cancelled: "部分取消",
			} as Record<string, string>
		)[status.toLowerCase()] ?? status
	)
}
export function columnLetter(index: number): string {
	let value = index + 1,
		result = ""
	while (value > 0) {
		value--
		result = String.fromCharCode(65 + (value % 26)) + result
		value = Math.floor(value / 26)
	}
	return result
}
export function parseRange(value: string) {
	const match = /^([A-Z]{1,3})([1-9]\d{0,3})(?::([A-Z]{1,3})([1-9]\d{0,3}))?$/.exec(value.toUpperCase())
	if (!match) throw new Error("请使用 A1 或 C2:D5 这样的单元格地址。")
	const col = (text: string) => [...text].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1
	const c1 = col(match[1]),
		c2 = col(match[3] || match[1]),
		r1 = Number(match[2]) - 1,
		r2 = Number(match[4] || match[2]) - 1
	const range = { top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) }
	if (range.right >= 200 || range.bottom >= 1000 || (range.right - range.left + 1) * (range.bottom - range.top + 1) > 10000)
		throw new Error("选区过大，请缩小范围。")
	return range
}
export function selectionAddress(top: number, left: number, bottom = top, right = left) {
	const a = `${columnLetter(left)}${top + 1}`,
		b = `${columnLetter(right)}${bottom + 1}`
	return a === b ? a : `${a}:${b}`
}
export function listSheets(session: BatchSession) {
	return [
		{ id: "current", title: "Batch_当前", runId: session.attempt?.runId },
		{ id: "progress", title: "运行记录", runId: session.attempt?.runId },
		...(session.pastRuns ?? []).map((run, i) => ({ id: `history:${run.runId}`, title: `历史_${i + 1}`, runId: run.runId })),
	]
}
export function buildSheet(session: BatchSession, id = "current"): BatchSheet {
	const history = id.startsWith("history:") ? session.pastRuns?.find((run) => run.runId === id.slice(8)) : undefined
	if (id !== "current" && id !== "progress" && !history) throw new Error("工作表不存在，请重新选择。")
	const source = history ?? session,
		rows = source.rows,
		results = source.results,
		tasks = source.tasks ?? []
	// A run can contain hundreds of rows. Index its status data once instead of
	// searching both arrays for every spreadsheet row on every progress update.
	const resultsByRow = new Map<number, (typeof results)[number]>()
	const tasksByRow = new Map<number, (typeof tasks)[number]>()
	for (const result of results) if (!resultsByRow.has(result.rowIndex)) resultsByRow.set(result.rowIndex, result)
	for (const task of tasks)
		if (task.sourceRowIndex !== undefined && !tasksByRow.has(task.sourceRowIndex)) tasksByRow.set(task.sourceRowIndex, task)
	const fields: BatchField[] = history
		? (history.listing?.schema?.fields ??
			[...new Set(rows.flatMap((row) => Object.keys(row.values)))].map((key) => ({
				key,
				label: key,
				value_type: "string",
			})))
		: (session.listing?.schema?.fields ?? [])
	const items: SheetRow[] = rows.map((row, index) => {
		const result = resultsByRow.get(index),
			task = tasksByRow.get(index)
		return {
			row,
			sourceIndex: index,
			status:
				result?.status ||
				task?.status ||
				(["selecting", "quantity", "collecting", "reviewing", "quoting", "quoted"].includes(source.phase)
					? "draft"
					: "unknown"),
			artifacts: result?.artifacts ?? [],
			error:
				result?.errorMessage ||
				task?.errorMessage ||
				(result?.stepErrors?.length ? JSON.stringify(result.stepErrors) : ""),
			taskId: task?.taskId || "",
		}
	})
	const columns: SheetColumn[] = [
		{ key: "id", label: "任务 ID", kind: "id", width: 76 },
		{ key: "status", label: "状态", kind: "status", width: 92 },
	]
	if (id === "progress")
		columns.push(
			{ key: "taskId", label: "服务端任务 ID", kind: "taskId", width: 240 },
			{ key: "progress", label: "执行进度", kind: "progress", width: 116 },
			{ key: "output:0", label: "产物", kind: "output", width: 220, outputIndex: 0 },
			{ key: "error", label: "错误详情", kind: "error", width: 340 },
		)
	else {
		columns.push(
			...fields.map((field) => ({
				key: field.key,
				label: (field.label || field.key) + (field.required ? " *" : ""),
				kind: "input" as const,
				field,
				width: field.presentation?.widget === "textarea" ? 260 : 176,
			})),
		)
		columns.push({ key: "progress", label: "生成进度", kind: "progress", width: 116 })
		const outputCount = Math.max(1, ...items.map((row) => row.artifacts.length))
		for (let i = 0; i < outputCount; i++)
			columns.push({ key: `output:${i}`, label: `输出 ${i + 1}`, kind: "output", width: 200, outputIndex: i })
		columns.push({ key: "error", label: "错误信息", kind: "error", width: 280 })
	}
	return {
		id,
		title: history?.listingName ?? session.listing?.name ?? "Batch 工作表",
		history,
		columns,
		rows: items,
		readOnly: !!history || id === "progress" || !session.enabled || !!session.attempt || session.phase === "quoting",
		runId: history?.runId ?? session.attempt?.runId,
	}
}
export function sheetValue(sheet: BatchSheet, rowIndex: number, colIndex: number, full = false): string {
	const col = sheet.columns[colIndex]
	if (!col) return ""
	if (rowIndex === 0) return col.label
	const item = sheet.rows[rowIndex - 1]
	if (!item) return ""
	switch (col.kind) {
		case "id":
			return String(item.sourceIndex + 1).padStart(3, "0")
		case "status":
			return statusLabel(item.status)
		case "taskId":
			return item.taskId || "—"
		case "input": {
			if (col.field?.value_type === "asset_ref")
				return (
					item.row.attachments
						.filter((a) => a.field === col.field?.key)
						.map((a) => a.name)
						.join("、") || "未上传"
				)
			const value = item.row.values[col.key]
			return value === undefined || value === null || value === ""
				? /model|模型/i.test(col.key + col.label)
					? "推荐默认"
					: ""
				: typeof value === "object"
					? JSON.stringify(value)
					: String(value)
		}
		case "progress":
			return ["completed", "succeeded", "success"].includes(item.status.toLowerCase())
				? "100%"
				: finished.has(item.status.toLowerCase())
					? "已结束"
					: statusLabel(item.status)
		case "error":
			return item.error
		case "output": {
			const a = item.artifacts[col.outputIndex ?? 0]
			return a
				? full
					? (a.inlineText ?? a.accessUrl ?? "")
					: `${a.portName || "产物"}${a.mimeType ? ` · ${a.mimeType}` : ""}`
				: ""
		}
	}
}
export function readSheetRange(sheet: BatchSheet, address: string, full = false) {
	const r = parseRange(address),
		values: string[][] = []
	for (let row = r.top; row <= r.bottom; row++) {
		const line: string[] = []
		for (let col = r.left; col <= r.right; col++) line.push(sheetValue(sheet, row, col, full))
		values.push(line)
	}
	return values
}
export function rangePatches(sheet: BatchSheet, address: string, values: BatchValue[][]) {
	if (sheet.readOnly) throw new Error("此工作表为只读，已提交的输入不能修改。")
	const range = parseRange(address)
	if (!values.length || !values[0]?.length || values.some((row) => row.length !== values[0].length))
		throw new Error("粘贴区域必须是完整的矩形数据。")
	if (
		address.includes(":") &&
		(values.length !== range.bottom - range.top + 1 || values[0].length !== range.right - range.left + 1)
	)
		throw new Error("数据行列数与选区不一致。")
	const patches = new Map<string, Record<string, BatchValue>>()
	for (let y = 0; y < values.length; y++)
		for (let x = 0; x < values[y].length; x++) {
			const item = sheet.rows[range.top + y - 1],
				column = sheet.columns[range.left + x],
				field = column?.field
			if (!item || range.top + y === 0) throw new Error("选区超出本次输入，请先在工作表新增行。")
			if (column?.kind !== "input" || !field || field.value_type === "asset_ref")
				throw new Error("状态、产物和文件标识不能手工填写；文件请使用添加文件入口。")
			let value = values[y][x]
			const model = resolveBatchModelField(field)
			if (model.isModel && !model.allowOverride && value !== "" && value !== "推荐默认")
				throw new Error("此模型字段未公开可靠的可选配置，请保留推荐默认。")
			if (value === "推荐默认" && model.isModel) value = ""
			if (field.enum_values?.length && value !== "" && !field.enum_values.includes(value))
				throw new Error(`「${field.label || field.key}」必须从可选项中选择。`)
			if (field.value_type === "boolean" && typeof value === "string") {
				if (["true", "是"].includes(value)) value = true
				else if (["false", "否"].includes(value)) value = false
				else if (value !== "") throw new Error("布尔字段需要是/否。")
			}
			const current = patches.get(item.row.id) ?? {}
			current[field.key] = value
			patches.set(item.row.id, current)
		}
	return [...patches].map(([id, values]) => ({ id, values }))
}
export function parseTsv(text: string): string[][] {
	const rows: string[][] = [[]]
	let cell = "",
		quoted = false
	for (let i = 0; i < text.length; i++) {
		const c = text[i]
		if (c === '"') {
			if (quoted && text[i + 1] === '"') {
				cell += '"'
				i++
			} else if (quoted || !cell) quoted = !quoted
			else cell += c
		} else if (!quoted && (c === "\t" || c === "\n" || c === "\r")) {
			rows[rows.length - 1].push(cell)
			cell = ""
			if (c !== "\t") {
				if (c === "\r" && text[i + 1] === "\n") i++
				rows.push([])
			}
		} else cell += c
	}
	if (quoted) throw new Error("粘贴数据的引号没有闭合。")
	rows[rows.length - 1].push(cell)
	if (rows.length > 1 && rows.at(-1)?.length === 1 && rows.at(-1)?.[0] === "") rows.pop()
	return rows
}
export function toTsv(rows: string[][]) {
	return rows
		.map((row) => row.map((cell) => (/[\t\r\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join("\t"))
		.join("\n")
}
