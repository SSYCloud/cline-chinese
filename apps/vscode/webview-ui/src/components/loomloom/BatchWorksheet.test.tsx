import type { BatchSession, BatchTableSnapshot } from "@shared/loomloom"
import { buildSheet, rangePatches } from "@shared/loomloom-sheet"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BatchWorksheet } from "./BatchWorksheet"

const rpc = vi.hoisted(() => ({
	subscribe: vi.fn(),
	operation: vi.fn(),
	get: vi.fn(),
	unsubscribe: vi.fn(),
	models: vi.fn(),
	action: vi.fn(),
	command: vi.fn(),
	creator: vi.fn(),
}))
const webviewState = vi.hoisted(() => ({ value: null as unknown }))
vi.mock("@/config/platform.config", async (original) => ({
	...(await original<typeof import("@/config/platform.config")>()),
	getWebviewState: () => webviewState.value,
	setWebviewState: (value: unknown) => {
		webviewState.value = value
	},
}))
vi.mock("@/services/grpc-client", () => ({
	LoomLoomServiceClient: {
		subscribeBatchTable: rpc.subscribe,
		worksheetOperation: rpc.operation,
		getBatchTableSnapshot: rpc.get,
		batchModels: rpc.models,
		batchTableAction: rpc.action,
		batchCommand: rpc.command,
		creatorCommand: rpc.creator,
	},
}))
let state: BatchTableSnapshot, emit: (r: { value: string }) => void
function publish() {
	emit({ value: JSON.stringify(state) })
}
function fixture(): BatchSession {
	return {
		version: 1,
		id: "batch",
		taskId: "same-task",
		enabled: true,
		revision: 5,
		phase: "collecting",
		events: [],
		results: [],
		artifacts: [],
		worksheet: { sheet: "current", range: "C2" },
		listing: {
			id: "bot",
			name: "文本扩写助手",
			versionId: "v1",
			description: "",
			availability: "available",
			schema: {
				schema_version: "loom_market_public_input_schema_v1",
				fields: [
					{ key: "text", label: "原文", required: true, value_type: "string" },
					{ key: "goal", label: "目标", value_type: "string" },
					{ key: "model", label: "模型", value_type: "string" },
				],
			},
		},
		rows: [
			{
				id: "r1",
				values: { text: "第一条", goal: "清晰" },
				attachments: [{ id: "file", name: "资料.md", path: "D:/资料.md" }],
			},
			{ id: "r2", values: { text: "第二条", goal: "简洁" }, attachments: [] },
		],
	}
}
beforeEach(() => {
	vi.clearAllMocks()
	webviewState.value = null
	state = { session: fixture(), editable: true }
	rpc.subscribe.mockImplementation((_request, callbacks) => {
		emit = callbacks.onResponse
		publish()
		return rpc.unsubscribe
	})
	rpc.get.mockImplementation(async () => ({ value: JSON.stringify(state) }))
	rpc.models.mockResolvedValue({ value: "[]" })
	rpc.action.mockResolvedValue({ value: "{}" })
	rpc.creator.mockResolvedValue({ value: JSON.stringify({ profiles: [] }) })
	rpc.command.mockImplementation(async (request) => {
		const { taskId, command } = JSON.parse(request.value)
		expect(taskId).toBe("same-task")
		const s = state.session!
		if (command.revision !== undefined && command.revision !== s.revision) throw new Error("输入已被更新")
		if (command.action === "review") s.phase = "reviewing"
		if (command.action === "quote") {
			s.phase = "quoted"
			s.quote = {
				id: "quoted-input",
				revision: s.revision,
				hash: "hash",
				inputRows: [],
				versionId: "v1",
				payable: { amount: "6.9900000", currency: "CNY" },
				taskCount: s.rows.length,
				at: Date.now(),
				valid: true,
			}
		}
		if (command.action === "execute") {
			if (command.quoteId !== s.quote?.id || s.attempt) throw new Error("预算已失效或已经提交")
			s.phase = "running"
			s.attempt = { requestId: command.quoteId, runId: "run-1", quote: s.quote }
		}
		if (command.action === "addRows") {
			for (let index = 0; index < command.count; index++)
				s.rows.push({ id: `r${s.rows.length + 1}`, values: {}, attachments: [] })
			s.revision++
			s.quote = undefined
			s.phase = "collecting"
		}
		if (command.action === "removeRows") {
			s.rows = s.rows.filter((row) => !command.rowIds.includes(row.id))
			s.revision++
			s.quote = undefined
			s.phase = "collecting"
		}
		publish()
		return { value: JSON.stringify(s) }
	})
	rpc.operation.mockImplementation(async (request) => {
		const { taskId, operation: op } = JSON.parse(request.value)
		expect(taskId).toBe("same-task")
		const s = state.session!
		if (op.action === "view") s.worksheet = { ...s.worksheet, ...op }
		if (op.action === "write") {
			if (op.revision !== s.revision) throw new Error("输入已被更新")
			for (const patch of rangePatches(buildSheet(s, op.sheet), op.range, op.values))
				Object.assign(s.rows.find((row) => row.id === patch.id)!.values, patch.values)
			s.revision++
			s.phase = "collecting"
		}
		publish()
		return { value: "{}" }
	})
})
afterEach(cleanup)
describe("Native Batch worksheet UI", () => {
	it("applies Agent creator changes live and asks before replacing unsaved local edits", async () => {
		rpc.creator.mockImplementation(async (call) => {
			const input = JSON.parse(call.value)
			return {
				value: JSON.stringify(
					input.command.action === "loadDraft"
						? { draft: { version: 1, name: "原草稿", advancedJson: "" }, updatedAt: 100 }
						: { profiles: [] },
				),
			}
		})
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const createButton = screen.getByRole("button", { name: /创造模式/ })
		await waitFor(() => expect(createButton).not.toBeDisabled())
		fireEvent.click(createButton)
		await act(async () => {
			await Promise.resolve()
		})
		const name = screen.getByPlaceholderText("如：产品文案改写")
		expect(name).toHaveValue("原草稿")
		fireEvent.change(name, { target: { value: "我正在编辑" } })
		act(() =>
			emit({
				value: JSON.stringify({
					kind: "creator",
					draft: { version: 1, name: "Cline 改好了", advancedJson: "" },
					updatedAt: 101,
					editable: true,
				}),
			}),
		)
		expect(name).toHaveValue("我正在编辑")
		expect(screen.getByText(/Cline 与你同时修改了创作草稿/)).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "载入 Cline 版本" }))
		expect(name).toHaveValue("Cline 改好了")
		await act(async () => {
			await Promise.resolve()
		})
	})
	it("opens creator mode in the same task and restores its draft with the Webview", async () => {
		const first = render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const createButton = screen.getByRole("button", { name: /创造模式/ })
		await waitFor(() => expect(createButton).not.toBeDisabled())
		fireEvent.click(createButton)
		await screen.findByRole("region", { name: "LoomLoom 创造模式" })
		fireEvent.change(screen.getByPlaceholderText("如：产品文案改写"), { target: { value: "我的文本工作流" } })
		first.unmount()
		expect((webviewState.value as { creator: { name: string } }).creator.name).toBe("我的文本工作流")
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("region", { name: "LoomLoom 创造模式" })
		expect(screen.getByPlaceholderText("如：产品文案改写")).toHaveValue("我的文本工作流")
	})
	it("restores an unsaved formula after VS Code suspends the hidden worksheet", async () => {
		const first = render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格内容"), { target: { value: "未保存的输入" } })
		first.unmount()
		const stored = webviewState.value as { taskId: string; formula?: { value: string } }
		expect(stored.taskId).toBe("same-task")
		expect(stored.formula?.value).toBe("未保存的输入")
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByLabelText("单元格内容")).toHaveValue("未保存的输入")
		expect(screen.getByText("取消此次编辑")).toBeInTheDocument()
	})
	it("lets the user review, see the budget and confirm the same batch from the worksheet", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("button", { name: "检查输入" }))
		await waitFor(() => expect(state.session!.phase).toBe("reviewing"))
		fireEvent.click(screen.getByRole("button", { name: "确认输入并查看预算" }))
		await screen.findByText("2 个任务 · 预计应付 6.99 CNY")
		fireEvent.click(screen.getByRole("button", { name: "确认并运行" }))
		await waitFor(() => expect(state.session!.attempt?.runId).toBe("run-1"))
		expect(rpc.command.mock.calls.map(([call]) => JSON.parse(call.value).command)).toEqual([
			{ action: "review", revision: 5 },
			{ action: "quote", revision: 5 },
			{ action: "execute", revision: 5, quoteId: "quoted-input" },
		])
		expect(screen.queryByRole("button", { name: "确认并运行" })).not.toBeInTheDocument()
	})
	it("imports an existing row reference into a text cell through the shared action", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByText("从文件导入文本")).toBeInTheDocument()
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		fireEvent.click(screen.getByText("用于此输入"))
		await waitFor(() => expect(rpc.operation).toHaveBeenCalled())
		expect(JSON.parse(rpc.operation.mock.calls[0][0].value).operation).toEqual({
			action: "import_reference",
			sheet: "current",
			range: "C2",
			revision: 5,
			attachmentId: "file",
		})
	})
	it("shows host-owned saved filenames and opens the persisted artifact", async () => {
		state.session!.phase = "completed"
		state.session!.attempt = { runId: "run", requestId: "req", quote: {} as never }
		state.session!.results = [
			{
				rowIndex: 0,
				status: "completed",
				artifacts: [{ inlineText: "<html><body>result</body></html>", mimeType: "text/html" }],
			},
		]
		state.session!.localOutputs = [
			{
				runId: "run",
				rowIndex: 0,
				artifactIndex: 0,
				contentHash: "host-hash",
				status: "saved",
				relativePath: ".cline/loomloom-outputs/run/row-0001/output-01.html",
				path: "D:/task/.cline/loomloom-outputs/run/row-0001/output-01.html",
			},
		]
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByText("output-01.html · 已保存")).toBeInTheDocument()
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "G2" }))
		expect(screen.getByText(/已保存：.cline\/loomloom-outputs/)).toBeInTheDocument()
		fireEvent.click(screen.getByText("打开本地文件"))
		await waitFor(() => expect(JSON.parse(rpc.operation.mock.calls.at(-1)![0].value).operation.action).toBe("open_output"))
	})
	it("does not let an older focus refresh overwrite a newer task-switch notification", async () => {
		let resolve!: (value: { value: string }) => void
		rpc.get.mockImplementationOnce(
			() =>
				new Promise((r) => {
					resolve = r
				}),
		)
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const oldSnapshot = JSON.stringify(state)
		fireEvent(window, new Event("focus"))
		act(() => {
			state.editable = false
			publish()
		})
		await act(async () => resolve({ value: oldSnapshot }))
		expect(screen.getByText("打开原对话")).toBeInTheDocument()
		expect(screen.getByText("编辑单元格")).toBeDisabled()
	})
	it("applies lightweight selection updates without replacing table data or a pending local selection", async () => {
		let finishView!: (value: { value: string }) => void
		rpc.operation.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishView = resolve
				}),
		)
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("gridcell", { name: "C3" }))
		await waitFor(() => expect(rpc.operation).toHaveBeenCalled())
		act(() => emit({ value: JSON.stringify({ kind: "view", worksheet: { sheet: "current", range: "C2" }, editable: true }) }))
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C3")
		expect(screen.getByText("第二条")).toBeInTheDocument()
		await act(async () => finishView({ value: JSON.stringify({ sheet: "current", range: "C3" }) }))
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C3")
	})
	it("does not discard unsaved formula text when selecting another cell", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格内容"), { target: { value: "尚未提交的素材" } })
		fireEvent.click(screen.getByRole("gridcell", { name: "C3" }))
		expect(screen.getByLabelText("单元格内容")).toHaveValue("尚未提交的素材")
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C2")
		expect(rpc.operation).not.toHaveBeenCalled()
		fireEvent.keyDown(screen.getByLabelText("单元格内容"), { key: "Escape" })
		expect(screen.getByLabelText("单元格内容")).toHaveValue("第一条")
	})
	it("anchors unsaved text to its original address when the Agent changes selection", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格内容"), { target: { value: "保存到原来的 C2" } })
		act(() => {
			state.session!.worksheet = { sheet: "current", range: "D3" }
			publish()
		})
		expect(screen.getByLabelText("单元格内容")).toHaveValue("保存到原来的 C2")
		fireEvent.keyDown(screen.getByLabelText("单元格内容"), { key: "Enter" })
		await waitFor(() => expect(state.session!.rows[0].values.text).toBe("保存到原来的 C2"))
		expect(state.session!.rows[1].values.goal).toBe("简洁")
		expect(JSON.parse(rpc.operation.mock.calls[0][0].value).operation.range).toBe("C2")
	})
	it("retains a pending edit as read-only while another task is active and offers return", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格内容"), { target: { value: "原对话的未保存内容" } })
		act(() => {
			state.editable = false
			publish()
		})
		expect(screen.getByLabelText("单元格内容")).toHaveAttribute("readonly")
		expect(screen.getByLabelText("单元格内容")).toHaveValue("原对话的未保存内容")
		fireEvent.keyDown(screen.getByLabelText("单元格内容"), { key: "Enter" })
		expect(rpc.operation).not.toHaveBeenCalled()
		fireEvent.click(screen.getByText("打开原对话"))
		await waitFor(() =>
			expect(rpc.action).toHaveBeenCalledWith({ value: JSON.stringify({ taskId: "same-task", action: "focusChat" }) }),
		)
	})
	it("renders Excel coordinates, compact filename cells, bottom sheets and no second chat", async () => {
		const view = render(<BatchWorksheet taskId="same-task" />)
		expect(await screen.findByRole("grid", { name: "Batch 电子表格" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "选择 C 列" })).toBeInTheDocument()
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C2")
		expect(screen.queryByRole("columnheader", { name: /参考文件/ })).not.toBeInTheDocument()
		expect(screen.queryByText("资料.md")).not.toBeInTheDocument()
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		expect(within(screen.getByRole("dialog")).getByText(/资料.md/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "运行记录" })).toBeInTheDocument()
		expect(screen.queryByText("确认并运行")).not.toBeInTheDocument()
		view.unmount()
		expect(rpc.unsubscribe).toHaveBeenCalled()
	})
	it("adds one or several rows to the current worksheet and keeps the selected input cell aligned", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("button", { name: /新增行/ }))
		await waitFor(() => expect(state.session!.rows).toHaveLength(3))
		expect(screen.getByRole("gridcell", { name: "C4" })).toBeInTheDocument()
		fireEvent.change(screen.getByLabelText("新增行数"), { target: { value: "2" } })
		fireEvent.click(screen.getByRole("button", { name: /新增行/ }))
		await waitFor(() => expect(state.session!.rows).toHaveLength(5))
		expect(rpc.command.mock.calls.map(([call]) => JSON.parse(call.value).command)).toEqual([
			{ action: "addRows", revision: 5, count: 1 },
			{ action: "addRows", revision: 6, count: 2 },
		])
		expect(screen.getByText("5 条任务")).toBeInTheDocument()
	})
	it("requires confirmation before deleting selected filled rows and keeps the sheet in sync", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("button", { name: "删除选中行" }))
		const dialog = screen.getByRole("alertdialog", { name: "删除输入行" })
		expect(within(dialog).getByText(/1 行已填写、1 个文件已附加/)).toBeInTheDocument()
		expect(state.session!.rows).toHaveLength(2)
		fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }))
		await waitFor(() => expect(state.session!.rows).toHaveLength(1))
		expect(state.session!.rows[0].id).toBe("r2")
		expect(JSON.parse(rpc.command.mock.calls[0][0].value).command).toEqual({
			action: "removeRows",
			revision: 5,
			rowIds: ["r1"],
		})
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
	})
	it("locks structural edits in historical and submitted sheets", async () => {
		state.session!.attempt = { requestId: "quoted", runId: "run", quote: {} as never }
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByRole("button", { name: /新增行/ })).toBeDisabled()
		expect(screen.getByRole("button", { name: "删除选中行" })).toBeDisabled()
	})
	it("renders only nearby cells in a large batch and can jump to a distant address", async () => {
		state.session!.rows = Array.from({ length: 400 }, (_, index) => ({
			id: `r${index + 1}`,
			values: { text: `第 ${index + 1} 条` },
			attachments: [],
		}))
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid", { name: "Batch 电子表格" })
		expect(within(grid).queryByRole("gridcell", { name: "C401" })).not.toBeInTheDocument()
		expect(within(grid).getAllByRole("row").length).toBeLessThan(60)
		fireEvent.change(screen.getByLabelText("单元格地址"), { target: { value: "C401" } })
		fireEvent.keyDown(screen.getByLabelText("单元格地址"), { key: "Enter" })
		await waitFor(() => expect(within(grid).getByRole("gridcell", { name: "C401" })).toHaveTextContent("第 400 条"))
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C401")
	})
	it("writes a cell through the shared operation and follows Agent updates", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格内容"), { target: { value: "用户改第一条" } })
		fireEvent.keyDown(screen.getByLabelText("单元格内容"), { key: "Enter" })
		await waitFor(() => expect(state.session?.rows[0].values.text).toBe("用户改第一条"))
		expect(JSON.parse(rpc.operation.mock.calls[0][0].value).operation).toEqual({
			action: "write",
			sheet: "current",
			range: "C2",
			revision: 5,
			values: [["用户改第一条"]],
		})
		act(() => {
			state.session!.rows[1].values.text = "Agent 更新第二条"
			state.session!.worksheet = { sheet: "current", range: "C3" }
			state.session!.revision++
			publish()
		})
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C3")
		expect(screen.getByLabelText("单元格内容")).toHaveValue("Agent 更新第二条")
	})
	it("pastes a multiline rectangular range using the same input revision", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.paste(grid, { clipboardData: { getData: () => '"原文第一行\n第二行"\t新目标\n原文二\t目标二' } })
		await waitFor(() => expect(state.session!.rows[0].values.text).toBe("原文第一行\n第二行"))
		expect(state.session!.rows[1].values.goal).toBe("目标二")
	})
	it("shows a conflict instead of overwriting an Agent edit while the modal is open", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.click(screen.getByText("编辑单元格"))
		const dialog = screen.getByRole("dialog")
		fireEvent.change(within(dialog).getByLabelText("原文 *"), { target: { value: "未保存文字" } })
		act(() => {
			state.session!.revision++
			state.session!.rows[0].values.text = "Agent 更新"
			publish()
		})
		expect(within(dialog).getByText(/输入已被更新/)).toBeInTheDocument()
		expect(within(dialog).getByText("保存到工作表")).toBeDisabled()
		expect(within(dialog).getByLabelText("原文 *")).toHaveValue("未保存文字")
	})
	it("uses a selector for the recommended model, not free text", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "E2" }))
		expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue("")
	})
	it("keeps HTML inert and moves full output into the cell dialog", async () => {
		state.session!.phase = "completed"
		state.session!.attempt = { runId: "run", requestId: "req", quote: {} as never }
		state.session!.progress = { status: "completed", total: 2, completed: 2, failed: 0 }
		state.session!.results = [
			{
				rowIndex: 0,
				status: "completed",
				artifacts: [{ inlineText: '<h1 data-unsafe="1">长内容</h1>', mimeType: "text/html" }],
			},
		]
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.queryByText('<h1 data-unsafe="1">长内容</h1>')).not.toBeInTheDocument()
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "G2" }))
		expect(screen.getByText('<h1 data-unsafe="1">长内容</h1>')).toBeInTheDocument()
		expect(document.querySelector('[data-unsafe="1"]')).toBeNull()
		expect(screen.queryByText("保存到工作表")).not.toBeInTheDocument()
		fireEvent.click(screen.getByText("保存并打开 / 查看产物"))
		await waitFor(() => expect(JSON.parse(rpc.operation.mock.calls.at(-1)![0].value).operation.action).toBe("open_output"))
	})
	it("switches the active sheet via shared state and disables editing for another task", async () => {
		state.editable = false
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByText(/关联另一条 Cline 任务/)).toBeInTheDocument()
		expect(screen.getByText("编辑单元格")).toBeDisabled()
		fireEvent.click(screen.getByText("运行记录"))
		await waitFor(() => expect(state.session!.worksheet!.sheet).toBe("progress"))
		expect(screen.getByText("服务端任务 ID")).toBeInTheDocument()
	})
})
