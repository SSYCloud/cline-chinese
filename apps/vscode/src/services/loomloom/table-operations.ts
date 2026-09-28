import { type BatchTableHostAction, type BatchValue, type BatchWorksheetView, effectiveTaskCount } from "@shared/loomloom"
import { getBatchFileInputMode } from "@shared/loomloom-files"
import { filterBatchFieldModels, resolveBatchModelField } from "@shared/loomloom-models"
import { buildSheet, listSheets, parseRange, readSheetRange, selectionAddress, sheetValue, toTsv } from "@shared/loomloom-sheet"
import { z } from "zod"
import type { BatchService } from "./batch-service"

export const tableOperationSchema = z.object({
	action: z.enum([
		"layout",
		"models",
		"read",
		"write",
		"delete_visual_rows",
		"edit_state",
		"view",
		"find",
		"copy",
		"cite",
		"attach",
		"import_reference",
		"remove_attachment",
		"open_output",
		"save_outputs",
		"refresh",
		"open",
	]),
	sheet: z.string().max(250).optional(),
	range: z.string().max(30).optional(),
	revision: z.number().int().nonnegative().optional(),
	panelId: z.string().min(1).max(100).optional(),
	batchId: z.string().min(1).max(200).optional(),
	editing: z.boolean().optional(),
	confirmed: z.boolean().optional(),
	values: z.array(z.array(z.unknown()).max(200)).max(100).optional(),
	text: z.string().max(1000).optional(),
	full: z.boolean().optional(),
	attachmentId: z.string().max(200).optional(),
	wrap: z.boolean().optional(),
	freeze: z.boolean().optional(),
	gridlines: z.boolean().optional(),
	zoom: z.number().min(80).max(130).optional(),
	fontSize: z.number().min(11).max(16).optional(),
	bold: z.boolean().optional(),
	columnWidths: z.record(z.string().regex(/^[A-Z]{1,3}$/), z.number().min(55).max(640)).optional(),
})
export type BatchTableOperation = z.infer<typeof tableOperationSchema>
export interface TableNativePort {
	open(taskId: string, preserveFocus?: boolean): Promise<void>
	action(input: BatchTableHostAction): Promise<void>
	attach(taskId: string, revision: number, rowId: string, field?: string, sourceAttachmentId?: string): Promise<void>
	models(stepType: string): Promise<{ id: string; name: string }[]>
}

/** Both the table Webview and the Agent call this dispatcher. It never quotes or executes. */
export class BatchTableService {
	constructor(
		private readonly batch: BatchService,
		private readonly native: TableNativePort,
		private readonly currentTask: () => string | undefined,
	) {}
	async execute(taskId: string, raw: unknown, actor: "user" | "agent" = "user") {
		if (JSON.stringify(raw).length > 1_000_000) throw new Error("操作数据过大，请缩小选区。")
		const op = tableOperationSchema.parse(raw)
		if (op.action === "edit_state") {
			if (actor !== "user") throw new Error("只有工作表界面可以设置未提交编辑状态。")
			if (!op.panelId || !op.batchId || op.editing === undefined)
				throw new Error("编辑状态需要 panelId、batchId 和 editing。")
			if (op.editing && taskId !== this.currentTask()) throw new Error("请先打开此表格关联的原任务。")
			await this.batch.setWorksheetEditLease(
				taskId,
				op.panelId,
				op.batchId,
				op.editing,
				() => taskId === this.currentTask(),
			)
			return { editing: op.editing }
		}
		if (op.action === "delete_visual_rows") {
			if (taskId !== this.currentTask()) throw new Error("请先在 Cline 打开此表格关联的原任务。")
			if (op.sheet !== "current" || op.revision === undefined || !op.range)
				throw new Error("删除行需要当前工作表、revision 和明确的视觉行选区。")
			const selected = parseRange(op.range)
			const result = await this.batch.deleteVisualRows(
				taskId,
				op.revision,
				selected.top + 1,
				selected.bottom + 1,
				op.confirmed === true,
				actor,
				() => taskId === this.currentTask(),
			)
			return { taskId, ...result }
		}
		if (op.action === "view") {
			const meta = await this.batch.worksheetMetadata(taskId)
			if (!meta) throw new Error("找不到此任务的 Batch 工作表。")
			if (actor === "agent" && (!meta.enabled || taskId !== this.currentTask()))
				throw new Error("只能操作当前 Batch 会话的工作表。")
			const sheetId = op.sheet ?? meta.worksheet?.sheet ?? "current",
				address = op.range ?? meta.worksheet?.range ?? "C2"
			parseRange(address)
			if (
				sheetId !== "current" &&
				sheetId !== "progress" &&
				(!sheetId.startsWith("history:") || !meta.historyRunIds.includes(sheetId.slice(8)))
			)
				throw new Error("工作表不存在，请重新选择。")
			const view: BatchWorksheetView = { ...meta.worksheet, sheet: sheetId, range: address }
			for (const key of ["wrap", "freeze", "gridlines", "zoom", "fontSize"] as const)
				if (op[key] !== undefined) Object.assign(view, { [key]: op[key] })
			if (op.columnWidths) view.columnWidths = { ...view.columnWidths, ...op.columnWidths }
			if (op.bold !== undefined) {
				view.boldRanges = (view.boldRanges ?? []).filter((value) => value !== address)
				if (op.bold) view.boldRanges.push(address)
				if (view.boldRanges.length > 100) throw new Error("已达到单元格格式数量上限。")
			}
			const saved = await this.batch.updateWorksheet(
				taskId,
				view,
				(session) =>
					(actor !== "agent" || (session.enabled && taskId === this.currentTask())) &&
					(sheetId === "current" ||
						sheetId === "progress" ||
						(sheetId.startsWith("history:") &&
							!!session.pastRuns?.some((run) => `history:${run.runId}` === sheetId))),
			)
			if (!saved) throw new Error("工作表或会话已变化，请重新选择。")
			if (actor === "agent") await this.native.open(taskId, true)
			return saved
		}
		if (op.action === "write") {
			if (taskId !== this.currentTask()) throw new Error("请先在 Cline 打开此表格关联的原任务。")
			if (op.revision === undefined || !op.values) throw new Error("写入需要当前 revision 和二维 values。")
			const result = await this.batch.writeWorksheet(
				taskId,
				op.revision,
				op.sheet,
				op.range,
				op.values as BatchValue[][],
				actor,
				() => taskId === this.currentTask(),
			)
			return { taskId, revision: result.revision, rowsChanged: result.rowsChanged, quoteValid: result.quoteValid }
		}
		const s = await this.batch.snapshot(taskId)
		if (!s) throw new Error("找不到此任务的 Batch 工作表。")
		if (actor === "agent" && (!s.enabled || taskId !== this.currentTask()))
			throw new Error("只能操作当前 Batch 会话的工作表。")
		const sheet = buildSheet(s, op.sheet ?? s.worksheet?.sheet ?? "current"),
			address = op.range ?? s.worksheet?.range ?? "C2",
			range = parseRange(address)
		const layout = () => ({
			taskId,
			batchId: s.id,
			revision: s.revision,
			sheet: sheet.id,
			readOnly: sheet.readOnly || taskId !== this.currentTask(),
			range,
			sheets: listSheets(s),
			columns: sheet.columns.map((column, index) => ({
				column: selectionAddress(0, index).replace(/1$/, ""),
				label: column.label,
				fieldKey: column.field?.key,
				field: column.field,
				editable: column.kind === "input" && column.field?.value_type !== "asset_ref" && !sheet.readOnly,
			})),
			rowCount: sheet.rows.length,
			visualRowCount: 1000,
			billableTaskCount: effectiveTaskCount(sheet.history?.rows ?? s.rows),
			progress: sheet.history?.progress ?? s.progress,
		})
		switch (op.action) {
			case "layout":
				return layout()
			case "models": {
				const field = sheet.columns[range.left]?.field
				const model = field && resolveBatchModelField(field)
				return {
					defaultModelId: model?.defaultModelId,
					recommendedDefault: true,
					items:
						field && model?.stepType && model.allowOverride
							? filterBatchFieldModels(field, await this.native.models(model.stepType))
							: [],
				}
			}
			case "read": {
				const size = (range.bottom - range.top + 1) * (range.right - range.left + 1)
				if (size > 500 || (op.full && size > 20)) throw new Error("请分段读取选区；完整长内容每次最多 20 个单元格。")
				const values = readSheetRange(sheet, address, true)
				const visualBySource = new Map(
					sheet.rows.filter((row) => !row.isBlank).map((row) => [row.sourceIndex, row.sheetRowNumber - 1]),
				)
				let truncated = false
				return {
					...layout(),
					localFiles: (s.localOutputs ?? [])
						.filter(
							(file) =>
								file.runId === sheet.runId &&
								(visualBySource.get(file.rowIndex) ?? -1) >= range.top &&
								(visualBySource.get(file.rowIndex) ?? -1) <= range.bottom &&
								sheet.columns
									.slice(range.left, range.right + 1)
									.some(
										(column) => column.kind === "output" && (column.outputIndex ?? 0) === file.artifactIndex,
									),
						)
						.slice(0, 20),
					values: values.map((row) =>
						row.map((value) => {
							if (!op.full && value.length > 1800) {
								truncated = true
								return value.slice(0, 1800) + "…"
							}
							return value
						}),
					),
					truncated,
				}
			}
			case "find": {
				const needle = op.text?.trim().toLowerCase()
				if (!needle) throw new Error("请输入查找内容。")
				const found: { row: number; col: number }[] = []
				for (let row = 1; row <= sheet.rows.length; row++)
					for (let col = 0; col < sheet.columns.length; col++)
						if (sheetValue(sheet, row, col, true).toLowerCase().includes(needle)) found.push({ row, col })
				if (!found.length) return { found: false }
				const next =
						found.find((pos) => pos.row > range.top || (pos.row === range.top && pos.col > range.left)) ?? found[0],
					selected = selectionAddress(next.row, next.col)
				await this.batch.updateWorksheet(taskId, { ...s.worksheet, sheet: sheet.id, range: selected })
				if (actor === "agent") await this.native.open(taskId, true)
				return { found: true, range: selected, count: found.length }
			}
			case "copy": {
				const text = toTsv(readSheetRange(sheet, address, true))
				if (text.length > 1_000_000) throw new Error("选区内容太大，请缩小复制范围。")
				await this.native.action({ taskId, action: "copyText", text })
				return { copied: address }
			}
			case "cite": {
				if (taskId !== this.currentTask()) throw new Error("请先在 Cline 打开表格关联的原任务。")
				await this.batch.updateWorksheet(taskId, { ...s.worksheet, sheet: sheet.id, range: address })
				await this.native.action({
					taskId,
					action: "cite",
					text: `请查看 Batch 工作表「${sheet.title}」的 ${address} 选区，结合当前输入和结果继续处理。`,
				})
				return { referenced: address }
			}
			case "attach":
			case "import_reference":
			case "remove_attachment": {
				if (sheet.readOnly || taskId !== this.currentTask() || op.revision === undefined)
					throw new Error("只有当前任务的未提交输入可以添加或移除文件。")
				if (op.revision !== s.revision) throw new Error("输入已被更新，请读取当前 revision 后重试。")
				const row = sheet.rows[range.top - 1],
					field = sheet.columns[range.left]?.field
				if (op.action === "remove_attachment") {
					if (!row || row.isBlank) throw new Error("此处没有可移除附件的输入行。")
					if (!op.attachmentId) throw new Error("请提供附件 ID。")
					await this.batch.command(
						taskId,
						{ action: "removeAttachment", revision: op.revision, rowId: row.row.id, attachmentId: op.attachmentId },
						actor,
					)
				} else if (op.action === "import_reference") {
					if (!row || row.isBlank) throw new Error("此处没有可导入的参考文件。")
					if (!op.attachmentId) throw new Error("请提供要导入的参考附件 ID。")
					if (!field || !getBatchFileInputMode(field)) throw new Error("请选择明确的文本输入或素材单元格。")
					if (!row.row.attachments.some((attachment) => attachment.id === op.attachmentId))
						throw new Error("此参考文件不属于当前输入行。")
					const reservation = await this.batch.reserveWorksheetAttachmentRow(
						taskId,
						op.revision,
						range.top + 1,
						field.key,
						() => taskId === this.currentTask(),
					)
					try {
						await this.native.attach(taskId, op.revision, reservation.rowId, field.key, op.attachmentId)
					} finally {
						await reservation.release()
					}
				} else {
					if ((!row || row.isBlank) && !field) throw new Error("请选择明确的文本输入或素材单元格。")
					if (field && !getBatchFileInputMode(field))
						throw new Error("此字段不支持文件导入，请选择文本输入或素材单元格。")
					const reservation = await this.batch.reserveWorksheetAttachmentRow(
						taskId,
						op.revision,
						range.top + 1,
						field?.key,
						() => taskId === this.currentTask(),
					)
					try {
						await this.native.attach(taskId, op.revision, reservation.rowId, field?.key)
					} finally {
						await reservation.release()
					}
				}
				return { updated: true }
			}
			case "open_output": {
				const row = sheet.rows[range.top - 1],
					col = sheet.columns[range.left]
				if (!row || row.isBlank || col?.kind !== "output") throw new Error("请选择一个输出单元格。")
				await this.native.action({
					taskId,
					action: "openArtifact",
					runId: sheet.runId,
					rowIndex: row.sourceIndex,
					artifactIndex: col.outputIndex,
				})
				return { opened: true }
			}
			case "save_outputs":
				if (!sheet.runId) throw new Error("暂无可保存的运行结果。")
				await this.native.action({ taskId, action: "saveOutputs", runId: sheet.runId })
				{
					const files =
						(await this.batch.snapshot(taskId))?.localOutputs?.filter((file) => file.runId === sheet.runId) ?? []
					return {
						saved: files.filter((f) => f.status === "saved").length,
						failed: files.filter((f) => f.status === "error").length,
						files: files.slice(0, 20),
						more: files.length > 20,
					}
				}
			case "refresh":
				if (sheet.history) await this.batch.refreshHistory(taskId, sheet.history.runId)
				else if (s.attempt?.runId) await this.batch.command(taskId, { action: "refreshRun" }, actor)
				return {
					progress: sheet.history
						? (await this.batch.snapshot(taskId))?.pastRuns?.find((run) => run.runId === sheet.history?.runId)
								?.progress
						: (await this.batch.snapshot(taskId))?.progress,
				}
			case "open":
				await this.native.open(taskId, actor === "agent")
				return layout()
		}
	}
}
