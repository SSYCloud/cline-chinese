import { afterEach, describe, expect, it, mock } from "bun:test"
import { type BatchSession, effectiveTaskCount, type SkillBot, toBatchChatSnapshot } from "@shared/loomloom"
import { buildSheet, columnLetter, parseRange, parseTsv, rangePatches, readSheetRange, toTsv } from "@shared/loomloom-sheet"
import { BatchService } from "./batch-service"
import type { BatchApi } from "./client"
import { BatchTableService, type TableNativePort } from "./table-operations"
import { validateBatchTableRequest } from "./table-panel-policy"

const listing: SkillBot = {
	id: "listing",
	name: "真实 schema 测试替身",
	description: "",
	versionId: "v1",
	availability: "available",
	schema: {
		schema_version: "loom_market_public_input_schema_v1",
		fields: [
			{ key: "text", label: "原文", required: true, value_type: "string" },
			{ key: "goal", label: "目标", value_type: "string" },
			{ key: "file", label: "图片", value_type: "asset_ref" },
			{
				key: "model",
				label: "模型",
				value_type: "string",
				model_override: { step_type: "text-generate", allow_override: true, default_model_id: "default-model" },
			},
		],
	},
}
const services: BatchService[] = []
afterEach(() => {
	for (const service of services) service.dispose()
	services.length = 0
})
async function setup() {
	let current = "task"
	let rejectSave = false
	const persisted: BatchSession[] = []
	const api: BatchApi = {
		detail: async () => structuredClone(listing),
		quote: async (_id, _version, rows) => ({
			taskCount: rows.length,
			estimatedBuyerPayable: { amount: "0.3", currency: "CNY" },
		}),
		execute: mock(async () => ({ runId: "run1" })),
		run: mock(async () => ({
			status: "completed",
			total: 2,
			completed: 2,
			failed: 0,
			rows: [
				{
					rowIndex: 1,
					status: "completed",
					artifacts: [{ inlineText: "<script>untrusted()</script>", mimeType: "text/html", portName: "页面" }],
				},
			],
			artifacts: [],
			tasks: [
				{ taskId: "t1", sourceRowIndex: 0, status: "completed" },
				{ taskId: "t2", sourceRowIndex: 1, status: "completed" },
			],
			startedAt: 100,
			completedAt: 200,
		})),
	}
	const changed = mock(() => {})
	api.models = async () => [{ id: "supported", name: "Supported" }]
	const batch = new BatchService(
		{
			loadAll: async () => [],
			save: async (s) => {
				if (rejectSave) throw new Error("disk full")
				persisted.push(structuredClone(s))
			},
		},
		api,
		changed,
		60_000,
	)
	services.push(batch)
	const port: TableNativePort = {
		open: mock(async () => {}),
		action: mock(async () => {}),
		attach: mock(async () => {}),
		models: mock(async () => [{ id: "supported", name: "Supported" }]),
	}
	const table = new BatchTableService(batch, port, () => current)
	const snapshot = async () => (await batch.snapshot("task"))!
	await batch.setEnabled("task", true)
	await batch.configureOutputDestination("task", process.cwd())
	await batch.command("task", { action: "select", listingId: listing.id })
	await batch.command("task", { action: "quantity", revision: (await snapshot()).revision, count: 2 })
	await table.execute("task", {
		action: "write",
		range: "C2:D3",
		revision: (await snapshot()).revision,
		values: [
			["第一条", "目标一"],
			["第二条", "目标二"],
		],
	})
	async function quote() {
		await batch.command("task", { action: "review", revision: (await snapshot()).revision })
		return batch.command("task", { action: "quote", revision: (await snapshot()).revision })
	}
	async function run() {
		const s = await quote()
		await batch.command("task", { action: "execute", revision: s.revision, quoteId: s.quote!.id })
		await batch.command("task", { action: "refreshRun" })
	}
	return {
		batch,
		table,
		port,
		snapshot,
		quote,
		run,
		api,
		persisted,
		changed,
		setSaveFailure: (value: boolean) => {
			rejectSave = value
		},
		switchTask: () => {
			current = "other"
		},
	}
}
describe("Batch worksheet authority / Agent parity", () => {
	it("rechecks a visible local draft before review or paid execution, even before its lease RPC arrives", async () => {
		const { batch, snapshot, quote, api } = await setup()
		const probe = mock(async () => true)
		batch.setWorksheetDraftProbe(probe)
		await expect(batch.command("task", { action: "review", revision: (await snapshot()).revision })).rejects.toThrow(
			"未提交的编辑",
		)
		probe.mockResolvedValue(false)
		const quoted = await quote()
		probe.mockResolvedValue(true)
		await expect(
			batch.command("task", { action: "execute", revision: quoted.revision, quoteId: quoted.quote!.id }),
		).rejects.toThrow("未提交的编辑")
		expect(api.execute).not.toHaveBeenCalled()
		probe.mockRejectedValue(new Error("panel did not answer"))
		await expect(
			batch.command("task", { action: "execute", revision: quoted.revision, quoteId: quoted.quote!.id }),
		).rejects.toThrow("无法确认 Batch 工作表")
		expect(api.execute).not.toHaveBeenCalled()
	})
	it("materializes only C20, quotes one task, and maps run/history output back to visual row 20", async () => {
		const f = await setup()
		await f.batch.command("task", { action: "newBatch", revision: (await f.snapshot()).revision })
		const seed = await f.snapshot()
		expect(seed.rows).toHaveLength(1)
		expect(effectiveTaskCount(seed.rows)).toBe(0)
		const written = await f.table.execute("task", {
			action: "write",
			range: "C20",
			revision: seed.revision,
			values: [["只运行这一条"]],
		})
		expect(written).toMatchObject({ rowsChanged: 1, revision: seed.revision + 1 })
		const sparse = await f.snapshot()
		expect(sparse.rows).toHaveLength(1)
		expect(sparse.rows[0]).toMatchObject({ sheetRowNumber: 20, origin: "implicit", values: { text: "只运行这一条" } })
		expect(effectiveTaskCount(sparse.rows)).toBe(1)
		expect(await f.table.execute("task", { action: "read", range: "C2:C20" })).toMatchObject({
			values: [...Array.from({ length: 18 }, () => [""]), ["只运行这一条"]],
		})
		const quoted = await f.quote()
		expect(quoted.quote?.taskCount).toBe(1)
		expect(quoted.quote?.inputRows).toEqual([{ text: "只运行这一条" }])
		f.api.run = mock(async () => ({
			status: "completed",
			total: 1,
			completed: 1,
			failed: 0,
			rows: [{ rowIndex: 0, status: "completed", artifacts: [{ inlineText: "结果20", portName: "文本" }] }],
			artifacts: [],
			tasks: [{ taskId: "remote-1", sourceRowIndex: 0, status: "completed" }],
		}))
		await f.batch.command("task", { action: "execute", revision: quoted.revision, quoteId: quoted.quote!.id })
		await f.batch.command("task", { action: "refreshRun" })
		const finished = await f.snapshot()
		const sheet = buildSheet(finished)
		const output = sheet.columns.findIndex((column) => column.kind === "output")
		expect(sheet.rows[18]).toMatchObject({ sheetRowNumber: 20, sourceIndex: 0, status: "completed" })
		expect(readSheetRange(sheet, `${columnLetter(output)}20`, true)).toEqual([["结果20"]])
		await f.batch.command("task", { action: "newBatch", revision: finished.revision })
		const history = buildSheet(await f.snapshot(), "history:run1")
		expect(history.rows[18]).toMatchObject({ sheetRowNumber: 20, sourceIndex: 0 })
		expect(readSheetRange(history, `${columnLetter(output)}20`, true)).toEqual([["结果20"]])
	})
	it("reports visual capacity separately from tasks and labels an explicit empty row as defaults", async () => {
		const f = await setup()
		await f.batch.command("task", { action: "newBatch", revision: (await f.snapshot()).revision })
		const seed = await f.snapshot()
		expect(await f.table.execute("task", { action: "layout" })).toMatchObject({
			visualRowCount: 1000,
			billableTaskCount: 0,
		})
		await f.batch.command("task", { action: "addRows", revision: seed.revision, count: 1 })
		expect(await f.table.execute("task", { action: "read", range: "B2" })).toMatchObject({
			billableTaskCount: 1,
			values: [["使用默认值"]],
		})
	})
	it("deletes a visual gap like Excel and shifts the same task ID upward without changing its API order", async () => {
		const f = await setup()
		await f.batch.command("task", { action: "newBatch", revision: (await f.snapshot()).revision })
		await f.table.execute("task", {
			action: "write",
			range: "C20",
			revision: (await f.snapshot()).revision,
			values: [["稀疏输入"]],
		})
		const quoted = await f.quote()
		const originalId = quoted.rows[0].id
		const result = await f.table.execute("task", {
			action: "delete_visual_rows",
			sheet: "current",
			range: "A3:H4",
			revision: quoted.revision,
		})
		expect(result).toMatchObject({ tasksRemoved: 0, rowsShifted: 1, revision: quoted.revision + 1, quoteValid: false })
		const shifted = await f.snapshot()
		expect(shifted.rows).toHaveLength(1)
		expect(shifted.rows[0]).toMatchObject({ id: originalId, sheetRowNumber: 18, values: { text: "稀疏输入" } })
		expect(readSheetRange(buildSheet(shifted), "C18", true)).toEqual([["稀疏输入"]])
	})
	it("does not invalidate a quote when deleting unused rows below all materialized tasks", async () => {
		const f = await setup()
		const quoted = await f.quote()
		const deleted = await f.table.execute("task", {
			action: "delete_visual_rows",
			sheet: "current",
			range: "A20:H21",
			revision: quoted.revision,
		})
		expect(deleted).toMatchObject({ revision: quoted.revision, tasksRemoved: 0, rowsShifted: 0, quoteValid: true })
		expect((await f.snapshot()).quote?.valid).toBe(true)
	})
	it("requires user confirmation for filled visual-row deletion and leaves history read-only", async () => {
		const f = await setup()
		const before = await f.snapshot()
		const operation = {
			action: "delete_visual_rows",
			sheet: "current",
			range: "A2:H2",
			revision: before.revision,
		}
		await expect(f.table.execute("task", operation)).rejects.toThrow("确认删除")
		await expect(f.table.execute("task", { ...operation, confirmed: true }, "agent")).rejects.toThrow("只能由用户")
		expect((await f.snapshot()).rows).toEqual(before.rows)
		const deleted = await f.table.execute("task", { ...operation, confirmed: true })
		expect(deleted).toMatchObject({ tasksRemoved: 1, rowsShifted: 1 })
		expect((await f.snapshot()).rows[0]).toMatchObject({ sheetRowNumber: 2, values: { text: "第二条" } })
		await expect(f.table.execute("task", { ...operation, revision: before.revision, confirmed: true })).rejects.toThrow(
			"输入已被更新",
		)
	})
	it("holds an acknowledged dirty-editor lease against review, quote, run and workflow reset", async () => {
		const f = await setup()
		const quoted = await f.quote()
		await expect(
			f.table.execute("task", {
				action: "edit_state",
				panelId: "panel-a",
				batchId: "stale",
				editing: true,
			}),
		).rejects.toThrow("工作表会话已变化")
		await expect(
			f.table.execute(
				"task",
				{
					action: "edit_state",
					panelId: "panel-a",
					batchId: quoted.id,
					editing: true,
				},
				"agent",
			),
		).rejects.toThrow("只有工作表界面")
		await f.table.execute("task", { action: "edit_state", panelId: "panel-a", batchId: quoted.id, editing: true })
		expect((await f.batch.chatSnapshot("task"))?.pendingWorksheetEdit).toBe(true)
		await expect(f.batch.command("task", { action: "review", revision: quoted.revision })).rejects.toThrow("未提交的编辑")
		await expect(f.batch.command("task", { action: "quote", revision: quoted.revision })).rejects.toThrow("未提交的编辑")
		await expect(
			f.batch.command("task", {
				action: "execute",
				revision: quoted.revision,
				quoteId: quoted.quote!.id,
			}),
		).rejects.toThrow("未提交的编辑")
		await expect(f.batch.command("task", { action: "newBatch", revision: quoted.revision })).rejects.toThrow("未提交的编辑")
		await expect(f.batch.command("task", { action: "select", listingId: listing.id })).rejects.toThrow("未提交的编辑")
		await expect(
			f.table.execute("task", {
				action: "delete_visual_rows",
				sheet: "current",
				range: "A2:H2",
				revision: quoted.revision,
				confirmed: true,
			}),
		).rejects.toThrow("未提交的编辑")
		expect(f.api.execute).not.toHaveBeenCalled()
		await f.batch.releaseWorksheetEditLease("task", "panel-a")
		expect((await f.batch.chatSnapshot("task"))?.pendingWorksheetEdit).toBe(false)
		expect((await f.snapshot()).quote?.valid).toBe(true)
	})
	it("keeps the edit gate until every panel lease is ended or disposed", async () => {
		const f = await setup()
		const s = await f.snapshot()
		await f.table.execute("task", { action: "edit_state", panelId: "a", batchId: s.id, editing: true })
		await f.table.execute("task", { action: "edit_state", panelId: "b", batchId: s.id, editing: true })
		await f.table.execute("task", { action: "edit_state", panelId: "a", batchId: s.id, editing: false })
		expect((await f.batch.chatSnapshot("task"))?.pendingWorksheetEdit).toBe(true)
		await f.batch.releaseWorksheetEditLease("task", "b")
		await f.batch.releaseWorksheetEditLease("task", "b")
		expect((await f.batch.chatSnapshot("task"))?.pendingWorksheetEdit).toBe(false)
		expect((await f.snapshot()).revision).toBe(s.revision)
	})
	it("keeps an untouched image-only seed attachable without treating it as a task first", async () => {
		const f = await setup()
		await f.batch.command("task", { action: "newBatch", revision: (await f.snapshot()).revision })
		const seed = await f.snapshot()
		expect(buildSheet(seed).rows[0]).toMatchObject({ isBlank: false, sourceIndex: -1, row: { id: seed.rows[0].id } })
		expect(effectiveTaskCount(seed.rows)).toBe(0)
		await f.table.execute("task", { action: "attach", range: "E2", revision: seed.revision })
		expect(f.port.attach).toHaveBeenCalledWith("task", seed.revision, seed.rows[0].id, "file")
		await f.batch.attach("task", seed.revision, seed.rows[0].id, {
			id: "asset",
			name: "主图.png",
			path: "D:/main.png",
			field: "file",
			inputAssetId: "ia_real",
		})
		expect(effectiveTaskCount((await f.snapshot()).rows)).toBe(1)
	})
	it("blocks paid execution while a distant picker is open, then releases the reservation", async () => {
		const f = await setup()
		const quoted = await f.quote()
		let opened!: () => void
		let close!: () => void
		const pickerOpened = new Promise<void>((resolve) => {
			opened = resolve
		})
		const pickerClosed = new Promise<void>((resolve) => {
			close = resolve
		})
		f.port.attach = mock(async () => {
			opened()
			await pickerClosed
		})
		const attaching = f.table.execute("task", { action: "attach", range: "E20", revision: quoted.revision })
		await pickerOpened
		const during = await f.snapshot()
		expect(during.rows.at(-1)).toMatchObject({ sheetRowNumber: 20, origin: "implicit", values: {}, attachments: [] })
		expect(during.quote?.valid).toBe(true)
		await expect(
			f.batch.command("task", {
				action: "execute",
				revision: quoted.revision,
				quoteId: quoted.quote!.id,
			}),
		).rejects.toThrow("正在选择或上传")
		await expect(f.batch.command("task", { action: "quote", revision: quoted.revision })).rejects.toThrow("正在选择或上传")
		expect(f.api.execute).not.toHaveBeenCalled()
		close()
		await attaching
		expect((await f.snapshot()).quote?.valid).toBe(true)
	})
	it("leaves a failed distant upload nonbillable without consuming the quoted revision", async () => {
		const f = await setup()
		const quoted = await f.quote()
		f.port.attach = mock(async () => {
			throw new Error("upload failed")
		})
		await expect(f.table.execute("task", { action: "attach", range: "E20", revision: quoted.revision })).rejects.toThrow(
			"upload failed",
		)
		const after = await f.snapshot()
		expect(after.rows.at(-1)).toMatchObject({ sheetRowNumber: 20, origin: "implicit", values: {}, attachments: [] })
		expect(effectiveTaskCount(after.rows)).toBe(2)
		expect(after.revision).toBe(quoted.revision)
		expect(after.quote?.valid).toBe(true)
	})
	it("does not create a 101st task through a distant file picker", async () => {
		const f = await setup()
		await f.batch.command("task", { action: "newBatch", revision: (await f.snapshot()).revision })
		const seed = await f.snapshot()
		await f.batch.command("task", { action: "quantity", revision: seed.revision, count: 100 })
		const full = await f.snapshot()
		expect(effectiveTaskCount(full.rows)).toBe(100)
		await expect(f.table.execute("task", { action: "attach", range: "E200", revision: full.revision })).rejects.toThrow(
			"最多 100",
		)
		expect((await f.snapshot()).rows).toHaveLength(100)
		expect(f.port.attach).not.toHaveBeenCalled()
	})
	it("ignores all-empty sparse paste and preserves a quote on an identical worksheet write", async () => {
		const f = await setup()
		const quoted = await f.quote()
		const saved = f.persisted.length
		const noChange = await f.table.execute("task", {
			action: "write",
			range: "C2",
			revision: quoted.revision,
			values: [["第一条"]],
		})
		expect(noChange).toMatchObject({ revision: quoted.revision, rowsChanged: 0, quoteValid: true })
		expect(f.persisted).toHaveLength(saved)
		const empty = await f.table.execute("task", {
			action: "write",
			range: "C20:C21",
			revision: quoted.revision,
			values: [[""], [""]],
		})
		expect(empty).toMatchObject({ revision: quoted.revision, rowsChanged: 0, quoteValid: true })
		expect((await f.snapshot()).rows).toHaveLength(2)
		expect(f.persisted).toHaveLength(saved)
	})
	it("validates a distant paste atomically and removes an implicit row when its last value is cleared", async () => {
		const f = await setup()
		await f.batch.command("task", { action: "newBatch", revision: (await f.snapshot()).revision })
		const seed = await f.snapshot()
		const saves = f.persisted.length
		await expect(
			f.table.execute("task", {
				action: "write",
				range: "F20:F21",
				revision: seed.revision,
				values: [["supported"], ["invented"]],
			}),
		).rejects.toThrow("支持模型列表")
		expect((await f.snapshot()).rows).toEqual(seed.rows)
		expect(f.persisted).toHaveLength(saves)
		await f.table.execute("task", { action: "write", range: "C20", revision: seed.revision, values: [["待清除"]] })
		const filled = await f.snapshot()
		await f.table.execute("task", { action: "write", range: "C20", revision: filled.revision, values: [[""]] })
		const cleared = await f.snapshot()
		expect(cleared.rows).toHaveLength(0)
		expect(effectiveTaskCount(cleared.rows)).toBe(0)
	})
	it("does not expose a sparse row or invalidate a quote if durable save fails", async () => {
		const f = await setup()
		const quoted = await f.quote()
		const saved = f.persisted.length
		f.setSaveFailure(true)
		await expect(
			f.table.execute("task", {
				action: "write",
				range: "D20",
				revision: quoted.revision,
				values: [["新目标"]],
			}),
		).rejects.toThrow("disk full")
		const after = await f.snapshot()
		expect(after.rows).toEqual(quoted.rows)
		expect(after.revision).toBe(quoted.revision)
		expect(after.quote?.valid).toBe(true)
		expect(f.persisted).toHaveLength(saved)
	})
	it("rejects stale draft reset confirmation rather than clearing newer edits", async () => {
		const f = await setup(),
			s = await f.snapshot()
		await f.table.execute("task", { action: "write", range: "C2", revision: s.revision, values: [["更新后的输入"]] })
		await expect(f.batch.command("task", { action: "newBatch", revision: s.revision })).rejects.toThrow("输入已被更新")
		expect((await f.snapshot()).rows[0].values.text).toBe("更新后的输入")
	})
	it("maps A1 coordinates and multiline TSV without losing content", () => {
		expect(columnLetter(26)).toBe("AA")
		expect(parseRange("D5:C2")).toEqual({ top: 1, bottom: 4, left: 2, right: 3 })
		const rows = [
			["多行\n文字", "含\t制表符"],
			['中文 "引号"', "正常"],
		]
		expect(parseTsv(toTsv(rows))).toEqual(rows)
		expect(() => parseRange("ZZ9999")).toThrow()
		expect(() => parseTsv('"未闭合')).toThrow()
	})
	it("publishes agent changes to both views and reads user edits from the same revision", async () => {
		const f = await setup(),
			seen: BatchSession[] = []
		const unsub = f.batch.subscribe("task", (s) => seen.push(s))
		const before = await f.snapshot()
		await f.table.execute(
			"task",
			{ action: "write", range: "C3", revision: before.revision, values: [["Agent 修改第二条"]] },
			"agent",
		)
		expect(seen.at(-1)?.rows[1].values.text).toBe("Agent 修改第二条")
		expect(f.port.open).not.toHaveBeenCalled()
		await f.table.execute("task", {
			action: "write",
			range: "D2",
			revision: (await f.snapshot()).revision,
			values: [["用户在右侧修改"]],
		})
		expect(await f.table.execute("task", { action: "read", range: "C2:D3" }, "agent")).toMatchObject({
			values: [
				["第一条", "用户在右侧修改"],
				["Agent 修改第二条", "目标二"],
			],
		})
		unsub()
		const n = seen.length
		await f.batch.updateWorksheet("task", { sheet: "progress", range: "B2" })
		expect(seen.length).toBe(n)
	})
	it("invalidates a quote on table edits and rejects concurrent stale writes", async () => {
		const f = await setup(),
			s = await f.quote()
		const results = await Promise.allSettled([
			f.table.execute("task", { action: "write", range: "C2", revision: s.revision, values: [["user"]] }),
			f.table.execute("task", { action: "write", range: "C3", revision: s.revision, values: [["agent"]] }, "agent"),
		])
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
		expect((await f.snapshot()).quote?.valid).toBe(false)
		await expect(f.batch.command("task", { action: "execute", revision: s.revision, quoteId: s.quote!.id })).rejects.toThrow(
			"预算已失效",
		)
		expect(f.api.execute).not.toHaveBeenCalled()
	})
	it("shares selection and formatting without changing the input revision or quote", async () => {
		const f = await setup(),
			s = await f.quote()
		await f.table.execute(
			"task",
			{ action: "view", range: "C2:D3", wrap: true, freeze: false, zoom: 110, columnWidths: { C: 310 }, bold: true },
			"agent",
		)
		const updated = await f.snapshot()
		expect(updated.revision).toBe(s.revision)
		expect(updated.quote?.valid).toBe(true)
		expect(updated.worksheet).toMatchObject({ range: "C2:D3", wrap: true, columnWidths: { C: 310 }, boldRanges: ["C2:D3"] })
		await f.table.execute("task", { action: "find", text: "第二条" }, "agent")
		expect((await f.snapshot()).worksheet?.range).toBe("C3")
	})
	it("exposes schema/default models and validates list choices through the shared action", async () => {
		const f = await setup()
		expect(await f.table.execute("task", { action: "models", range: "F2" }, "agent")).toMatchObject({
			defaultModelId: "default-model",
			items: [{ id: "supported" }],
		})
		await expect(
			f.table.execute(
				"task",
				{ action: "write", range: "F2", revision: (await f.snapshot()).revision, values: [["invented"]] },
				"agent",
			),
		).rejects.toThrow("支持模型列表")
		await f.table.execute(
			"task",
			{ action: "write", range: "F2", revision: (await f.snapshot()).revision, values: [["supported"]] },
			"agent",
		)
		expect((await f.snapshot()).rows[0].values.model).toBe("supported")
	})
	it("keeps file IDs trusted while supporting attach, filenames and removal from the Agent", async () => {
		const f = await setup(),
			s = await f.snapshot()
		await f.table.execute("task", { action: "attach", range: "E2", revision: s.revision }, "agent")
		expect(f.port.attach).toHaveBeenCalledWith("task", s.revision, s.rows[0].id, "file")
		await expect(
			f.table.execute("task", { action: "write", range: "E2", revision: s.revision, values: [["ia_fake"]] }),
		).rejects.toThrow("文件标识")
		await f.batch.attach("task", s.revision, s.rows[0].id, {
			id: "attachment",
			name: "参考图.png",
			path: "D:/sample.png",
			field: "file",
			inputAssetId: "ia_real",
		})
		expect(await f.table.execute("task", { action: "read", range: "E2" }, "agent")).toMatchObject({
			values: [["参考图.png"]],
		})
		await f.table.execute(
			"task",
			{ action: "remove_attachment", range: "E2", revision: (await f.snapshot()).revision, attachmentId: "attachment" },
			"agent",
		)
		expect((await f.snapshot()).rows[0].attachments).toEqual([])
	})
	it("retains outputs as inert text and invokes the same native output/copy/cite ports", async () => {
		const f = await setup()
		await f.run()
		let s = await f.snapshot(),
			sheet = buildSheet(s)
		const out = sheet.columns.findIndex((c) => c.kind === "output"),
			address = columnLetter(out) + "3"
		expect(readSheetRange(sheet, address, true)).toEqual([["<script>untrusted()</script>"]])
		await f.table.execute("task", { action: "open_output", range: address }, "agent")
		expect(f.port.action).toHaveBeenCalledWith({
			taskId: "task",
			action: "openArtifact",
			runId: "run1",
			rowIndex: 1,
			artifactIndex: 0,
		})
		await f.table.execute("task", { action: "copy", range: address }, "agent")
		expect(f.port.action).toHaveBeenCalledWith({ taskId: "task", action: "copyText", text: "<script>untrusted()</script>" })
		await f.table.execute("task", { action: "cite", range: address })
		expect(f.port.action).toHaveBeenCalledWith(
			expect.objectContaining({ action: "cite", text: expect.stringContaining(address) }),
		)
		await f.batch.command("task", { action: "newBatch" })
		await f.table.execute("task", { action: "view", sheet: "history:run1", range: address }, "agent")
		expect(await f.table.execute("task", { action: "read", range: address, full: true }, "agent")).toMatchObject({
			readOnly: true,
			values: [["<script>untrusted()</script>"]],
		})
		await expect(
			f.table.execute("task", {
				action: "write",
				range: "C2",
				revision: (await f.snapshot()).revision,
				values: [["overwrite history"]],
			}),
		).rejects.toThrow("只读")
		expect(await f.table.execute("task", { action: "refresh" }, "agent")).toMatchObject({ progress: { completed: 2 } })
		s = await f.snapshot()
		expect(s.phase).toBe("collecting")
		expect(s.results).toEqual([])
	})
	it("rejects output/header writes atomically and bounds full reads", async () => {
		const f = await setup(),
			s = await f.snapshot(),
			sheet = buildSheet(s)
		expect(() => rangePatches(sheet, "B2:C2", [["fake status", "text"]])).toThrow()
		expect(() => rangePatches(sheet, "C1", [["rename"]])).toThrow()
		await expect(f.table.execute("task", { action: "read", range: "A1:Z2", full: true }, "agent")).rejects.toThrow("20")
		expect((await f.snapshot()).revision).toBe(s.revision)
	})
	it("cannot execute charges or cross into a different task", async () => {
		const f = await setup()
		await expect(f.table.execute("task", { action: "execute" }, "agent")).rejects.toThrow()
		f.switchTask()
		await expect(f.table.execute("task", { action: "layout" }, "agent")).rejects.toThrow("当前 Batch")
		await expect(f.table.execute("task", { action: "write", revision: 3, range: "C2", values: [["other"]] })).rejects.toThrow(
			"原任务",
		)
		expect(f.api.execute).not.toHaveBeenCalled()
	})
	it("keeps huge output/history payload out of the normal chat snapshot", async () => {
		const f = await setup()
		await f.run()
		await f.batch.command("task", { action: "newBatch" })
		const chat = toBatchChatSnapshot(await f.snapshot())!
		expect(chat.pastRunCount).toBe(1)
		expect(chat).not.toHaveProperty("pastRuns")
		expect(chat).not.toHaveProperty("results")
		expect(chat).not.toHaveProperty("artifacts")
	})
	it("pins native panel RPC to its task and allows human run controls, not unrelated RPCs", () => {
		const req = {
			service: "cline.LoomLoomService",
			method: "worksheetOperation",
			message: { value: JSON.stringify({ taskId: "task", operation: { action: "read" } }) },
			request_id: "r",
			is_streaming: false,
		}
		expect(() => validateBatchTableRequest("task", req)).not.toThrow()
		expect(() => validateBatchTableRequest("other", req)).toThrow("原任务")
		expect(() => validateBatchTableRequest("task", { ...req, service: "cline.TaskService" })).toThrow()
		for (const action of ["review", "revise", "quote", "execute", "refreshRun", "recoverRun", "newBatch"]) {
			const commandRequest = {
				...req,
				method: "batchCommand",
				message: { value: JSON.stringify({ taskId: "task", command: { action } }) },
			}
			// Payload/revision/quote validity remain enforced by parseBatchCommand
			// and BatchService after this task-pinned native-panel boundary.
			expect(() => validateBatchTableRequest("task", commandRequest)).not.toThrow()
			expect(() => validateBatchTableRequest("other", commandRequest)).toThrow("原任务")
		}
		for (const action of ["mode", "select", "quantity", "unexpected"]) {
			expect(() =>
				validateBatchTableRequest("task", {
					...req,
					method: "batchCommand",
					message: { value: JSON.stringify({ taskId: "task", command: { action } }) },
				}),
			).toThrow("不支持此命令")
		}
	})
})
