import { afterEach, describe, expect, it, mock } from "bun:test"
import { type BatchSession, type SkillBot, toBatchChatSnapshot } from "@shared/loomloom"
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
		switchTask: () => {
			current = "other"
		},
	}
}
describe("Batch worksheet authority / Agent parity", () => {
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
