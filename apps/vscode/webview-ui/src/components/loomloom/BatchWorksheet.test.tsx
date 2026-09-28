import type { BatchSession, BatchTableSnapshot } from "@shared/loomloom"
import { buildSheet, parseRange, rangeWritePlan } from "@shared/loomloom-sheet"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PLATFORM_CONFIG } from "@/config/platform.config"
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
let state: BatchTableSnapshot,
	emit: (r: { value: string }) => void,
	editLeaseHeld = false
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
	editLeaseHeld = false
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
		if (command.action === "revise") {
			s.quote = undefined
			s.phase = "reviewing"
		}
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
				s.rows.push({
					id: `r${s.rows.length + 1}`,
					sheetRowNumber: Math.max(1, ...s.rows.map((row, sourceIndex) => row.sheetRowNumber ?? sourceIndex + 2)) + 1,
					origin: "explicit",
					values: {},
					attachments: [],
				})
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
		if (op.action === "edit_state") {
			expect(op.batchId).toBe(s.id)
			editLeaseHeld = op.editing
		}
		if (op.action === "view") s.worksheet = { ...s.worksheet, ...op }
		if (op.action === "write") {
			if (op.revision !== s.revision) throw new Error("输入已被更新")
			for (const patch of rangeWritePlan(buildSheet(s, op.sheet), op.range, op.values)) {
				let row = s.rows.find((item) => item.id === patch.rowId)
				if (!row) {
					if (Object.values(patch.values).every((value) => value === "" || value === null || value === undefined))
						continue
					row = {
						id: `r${s.rows.length + 1}`,
						sheetRowNumber: patch.sheetRowNumber,
						origin: "implicit",
						values: {},
						attachments: [],
					}
					s.rows.push(row)
				}
				Object.assign(row.values, patch.values)
			}
			s.revision++
			s.phase = "collecting"
		}
		if (op.action === "delete_visual_rows") {
			if (editLeaseHeld) throw new Error("有未保存的工作表输入，不能删除视觉行")
			if (op.revision !== s.revision) throw new Error("输入已被更新")
			const selected = parseRange(op.range)
			const top = selected.top + 1
			const bottom = selected.bottom + 1
			const count = bottom - top + 1
			const mapped = s.rows.map((row, index) => ({ row, visual: row.sheetRowNumber ?? index + 2 }))
			if (
				mapped.some(
					({ row, visual }) =>
						visual >= top &&
						visual <= bottom &&
						(Object.values(row.values).some((value) => value !== "" && value !== null && value !== undefined) ||
							row.attachments.length),
				) &&
				!op.confirmed
			)
				throw new Error("有内容的行需要确认")
			s.rows = mapped
				.filter(({ visual }) => visual < top || visual > bottom)
				.map(({ row, visual }) => ({
					...row,
					sheetRowNumber: visual > bottom ? visual - count : visual,
				}))
			s.revision++
			s.quote = undefined
			s.phase = "collecting"
		}
		publish()
		return { value: JSON.stringify(["write", "delete_visual_rows"].includes(op.action) ? { revision: s.revision } : {}) }
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
		const stage = screen.getByRole("region", { name: "批处理下一步" })
		expect(stage.nextElementSibling).toBe(screen.getByRole("navigation", { name: "表格工具" }))
		expect(within(stage).getByText("1/3 · 检查输入")).toBeInTheDocument()
		expect(screen.getAllByRole("button", { name: "检查输入" })).toHaveLength(1)
		fireEvent.click(screen.getByRole("button", { name: "检查输入" }))
		await waitFor(() => expect(state.session!.phase).toBe("reviewing"))
		expect(within(stage).getByText("2/3 · 查看预算")).toBeInTheDocument()
		expect(within(stage).queryByRole("button", { name: "返回修改" })).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "确认输入并查看预算" }))
		await within(stage).findByText(/预计应付 6\.99 CNY/)
		expect(within(stage).getByText("3/3 · 确认运行")).toBeInTheDocument()
		expect(within(stage).getByText("确认后创建云端任务，最终费用以服务端结算为准。")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "确认并运行" }))
		await waitFor(() => expect(state.session!.attempt?.runId).toBe("run-1"))
		expect(rpc.command.mock.calls.map(([call]) => JSON.parse(call.value).command)).toEqual([
			{ action: "review", revision: 5 },
			{ action: "quote", revision: 5 },
			{ action: "execute", revision: 5, quoteId: "quoted-input" },
		])
		expect(screen.queryByRole("button", { name: "确认并运行" })).not.toBeInTheDocument()
	})
	it("keeps a visible but disabled Check input action until a billable row exists", async () => {
		state.session!.rows = [{ id: "seed", sheetRowNumber: 2, origin: "implicit", values: {}, attachments: [] }]
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const stage = screen.getByRole("region", { name: "批处理下一步" })
		expect(within(stage).getByText("待填写")).toBeInTheDocument()
		expect(within(stage).getByText("0 条任务")).toBeInTheDocument()
		expect(within(stage).getByRole("button", { name: "检查输入" })).toBeDisabled()
		expect(rpc.command).not.toHaveBeenCalled()
	})
	it("does not offer paid execution when a quote is stale", async () => {
		state.session!.phase = "quoted"
		state.session!.quote = {
			id: "expired",
			revision: state.session!.revision,
			hash: "hash",
			inputRows: [],
			versionId: "v1",
			payable: { amount: "6.9900000", currency: "CNY" },
			taskCount: 2,
			at: Date.now() - 11 * 60_000,
			valid: true,
		}
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const stage = screen.getByRole("region", { name: "批处理下一步" })
		expect(within(stage).getByText("预算需更新")).toBeInTheDocument()
		expect(within(stage).getByText(/旧预算已失效 6\.99 CNY/)).toBeInTheDocument()
		expect(within(stage).queryByRole("button", { name: "确认并运行" })).not.toBeInTheDocument()
		fireEvent.click(within(stage).getByRole("button", { name: "返回修改" }))
		await waitFor(() => expect(state.session!.phase).toBe("reviewing"))
		expect(rpc.command.mock.calls.map(([call]) => JSON.parse(call.value).command.action)).toEqual(["revise"])
	})
	it("shows a non-executable state while quoting or already running", async () => {
		state.session!.phase = "quoting"
		const first = render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const stage = screen.getByRole("region", { name: "批处理下一步" })
		expect(within(stage).getByRole("button", { name: "正在获取预算…" })).toBeDisabled()
		expect(within(stage).queryByRole("button", { name: "确认并运行" })).not.toBeInTheDocument()
		first.unmount()
		state.session!.phase = "running"
		state.session!.attempt = { requestId: "req", runId: "run", quote: {} as never }
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const runningStage = screen.getByRole("region", { name: "批处理下一步" })
		expect(within(runningStage).getByRole("button", { name: "运行中" })).toBeDisabled()
		expect(within(runningStage).queryByRole("button", { name: "确认并运行" })).not.toBeInTheDocument()
	})
	it("offers the next batch only after completion", async () => {
		state.session!.phase = "completed"
		state.session!.attempt = { requestId: "req", runId: "run", quote: {} as never }
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const stage = screen.getByRole("region", { name: "批处理下一步" })
		expect(within(stage).getByText("本批已结束")).toBeInTheDocument()
		fireEvent.click(within(stage).getByRole("button", { name: "沿用此 SkillBot 开始下一批" }))
		await waitFor(() =>
			expect(JSON.parse(rpc.command.mock.calls.at(-1)![0].value).command).toEqual({
				action: "newBatch",
				revision: 5,
			}),
		)
	})
	it("keeps historical batches read-only without a paid action", async () => {
		const current = state.session!
		current.pastRuns = [
			{
				runId: "old-run",
				listingName: "旧工作流",
				rows: current.rows,
				results: [],
				phase: "completed",
			},
		]
		current.worksheet = { sheet: "history:old-run", range: "C2" }
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const stage = screen.getByRole("region", { name: "历史批次" })
		expect(within(stage).getByText("历史批次 · 只读")).toBeInTheDocument()
		expect(within(stage).queryByRole("button", { name: "检查输入" })).not.toBeInTheDocument()
		expect(within(stage).queryByRole("button", { name: "确认并运行" })).not.toBeInTheDocument()
		expect(screen.queryByRole("region", { name: "批处理下一步" })).not.toBeInTheDocument()
		fireEvent.click(within(stage).getByRole("button", { name: "返回本批工作表" }))
		await waitFor(() => expect(state.session!.worksheet.sheet).toBe("current"))
	})
	it("imports an existing row reference into a text cell through the shared action", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByText("从文件导入文本")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "编辑单元格" }))
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
	it("previews an owned image inside the worksheet without exposing the signed URL", async () => {
		state.session!.phase = "completed"
		state.session!.attempt = { runId: "run-image", requestId: "req", quote: {} as never }
		state.session!.results = [
			{
				rowIndex: 0,
				status: "completed",
				artifacts: [{ accessUrl: "https://media.example/signed-secret", mimeType: "image/jpeg", portName: "主图" }],
			},
		]
		rpc.action.mockImplementation(async (call) => {
			const input = JSON.parse(call.value)
			return {
				value: JSON.stringify(
					input.action === "previewArtifact"
						? { uri: "vscode-resource:/local/cover.jpg", mimeType: "image/jpeg", relativePath: "run/row-1/cover.jpg" }
						: {},
				),
			}
		})
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("button", { name: "预览 G2 媒体产物" }))
		const image = await screen.findByRole("img", { name: "主图" })
		expect(image).toHaveAttribute("src", "vscode-resource:/local/cover.jpg")
		expect(screen.getByText("已保存：run/row-1/cover.jpg")).toBeInTheDocument()
		expect(screen.queryByText(/signed-secret/)).not.toBeInTheDocument()
		await waitFor(() => expect((webviewState.value as { editor?: unknown } | null)?.editor).toBeDefined())
		expect(JSON.stringify((webviewState.value as { editor?: unknown }).editor)).not.toContain("signed-secret")
		expect(JSON.parse(rpc.action.mock.calls[0][0].value)).toEqual({
			taskId: "same-task",
			action: "previewArtifact",
			runId: "run-image",
			rowIndex: 0,
			artifactIndex: 0,
		})
		fireEvent.click(screen.getByRole("button", { name: "关闭单元格详情" }))
		expect(screen.queryByRole("img", { name: "主图" })).not.toBeInTheDocument()
	})
	it("previews a video with user controls and no autoplay, and keeps a safe fallback on errors", async () => {
		state.session!.phase = "completed"
		state.session!.attempt = { runId: "run-video", requestId: "req", quote: {} as never }
		state.session!.results = [
			{
				rowIndex: 0,
				status: "completed",
				artifacts: [{ accessUrl: "https://media.example/signed", mimeType: "video/mp4" }],
			},
		]
		rpc.action.mockResolvedValueOnce({
			value: JSON.stringify({ uri: "vscode-resource:/local/clip.mp4", mimeType: "video/mp4" }),
		})
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "G2" }))
		const video = await screen.findByLabelText("Batch 视频产物")
		expect(video).toHaveAttribute("controls")
		expect(video).toHaveAttribute("preload", "metadata")
		expect(video).not.toHaveAttribute("autoplay")
		expect(video).toHaveAttribute("src", "vscode-resource:/local/clip.mp4")
		fireEvent.error(video)
		expect(screen.getByText(/视频无法解码/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "重试预览" })).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /在外部查看云端产物/ })).toBeInTheDocument()
	})
	it("uses the verified local MIME when the cloud declares an octet-stream media artifact", async () => {
		state.session!.phase = "completed"
		state.session!.attempt = { runId: "run-octet", requestId: "req", quote: {} as never }
		state.session!.results = [
			{
				rowIndex: 0,
				status: "completed",
				artifacts: [{ accessUrl: "https://media.example/photo.png", mimeType: "application/octet-stream" }],
			},
		]
		state.session!.localOutputs = [
			{
				runId: "run-octet",
				rowIndex: 0,
				artifactIndex: 0,
				contentHash: "hash",
				status: "saved",
				mimeType: "image/png",
				path: "D:/project/photo.png",
			},
		]
		rpc.action.mockResolvedValueOnce({
			value: JSON.stringify({ uri: "vscode-resource:/local/photo.png", mimeType: "image/png" }),
		})
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("button", { name: "预览 G2 媒体产物" }))
		expect(await screen.findByRole("img", { name: "Batch 图片产物" })).toHaveAttribute(
			"src",
			"vscode-resource:/local/photo.png",
		)
	})
	it("shows a project destination and sends native folder actions without accepting a typed path", async () => {
		state.session!.outputDestination = { baseDirectory: "D:/project" }
		state.session!.attempt = {
			runId: "run",
			requestId: "req",
			quote: {} as never,
			outputDestination: { baseDirectory: "D:/project" },
		}
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByText(/D:\/project\/\.cline\/loomloom-outputs/)).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "更改后续位置…" }))
		await waitFor(() =>
			expect(JSON.parse(rpc.action.mock.calls.at(-1)![0].value)).toEqual({
				taskId: "same-task",
				action: "chooseOutputDirectory",
			}),
		)
		fireEvent.click(screen.getByRole("button", { name: "另存本批…" }))
		await waitFor(() =>
			expect(JSON.parse(rpc.action.mock.calls.at(-1)![0].value)).toEqual({
				taskId: "same-task",
				action: "exportRunToDirectory",
				runId: "run",
			}),
		)
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
	it("commits a valid formula-bar edit before selecting another cell", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格内容"), { target: { value: "尚未提交的素材" } })
		fireEvent.click(screen.getByRole("gridcell", { name: "C3" }))
		await waitFor(() => expect(state.session!.rows[0].values.text).toBe("尚未提交的素材"))
		await waitFor(() => expect(screen.getByLabelText("单元格地址")).toHaveValue("C3"))
		expect(screen.getByLabelText("单元格内容")).toHaveValue("第二条")
	})
	it("keeps a stale formula-bar draft and selection when another actor edited the row", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格内容"), { target: { value: "我的草稿" } })
		act(() => {
			state.session!.revision++
			state.session!.rows[0].values.text = "Agent 已更新"
			publish()
		})
		fireEvent.click(screen.getByRole("gridcell", { name: "C3" }))
		await screen.findByText(/输入已被更新/)
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C2")
		expect(screen.getByLabelText("单元格内容")).toHaveValue("我的草稿")
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
		expect(screen.getByLabelText("C2 格内编辑")).toHaveValue("第一条")
		fireEvent.keyDown(screen.getByLabelText("C2 格内编辑"), { key: "Escape" })
		fireEvent.click(screen.getByRole("button", { name: "编辑单元格" }))
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
		expect(JSON.parse(rpc.operation.mock.calls[0][0].value).operation).toEqual({
			action: "delete_visual_rows",
			sheet: "current",
			range: "A2:H2",
			revision: 5,
			confirmed: true,
		})
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
	})
	it("deletes an empty visual row without confirmation and shifts lower row coordinates", async () => {
		state.session!.rows.push({
			id: "far",
			sheetRowNumber: 20,
			origin: "implicit",
			values: { text: "远处输入" },
			attachments: [],
		})
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格地址"), { target: { value: "C10" } })
		fireEvent.keyDown(screen.getByLabelText("单元格地址"), { key: "Enter" })
		fireEvent.click(screen.getByRole("button", { name: "删除选中行" }))
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
		await waitFor(() => expect(state.session!.rows.find((row) => row.id === "far")?.sheetRowNumber).toBe(19))
		const operation = rpc.operation.mock.calls
			.map(([call]) => JSON.parse(call.value).operation)
			.find((op) => op.action === "delete_visual_rows")
		expect(operation).toEqual({ action: "delete_visual_rows", sheet: "current", range: "A10:H10", revision: 5 })
		expect(screen.getByText("3 条任务")).toBeInTheDocument()
	})
	it("releases a prior edit lease before deleting a visual row", async () => {
		state.session!.rows.push({
			id: "far",
			sheetRowNumber: 20,
			origin: "implicit",
			values: { text: "远处输入" },
			attachments: [],
		})
		render(<BatchWorksheet panelId="panel-1" taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		await waitFor(() => expect(editLeaseHeld).toBe(true))
		fireEvent.keyDown(screen.getByLabelText("C2 格内编辑"), { key: "Escape" })
		fireEvent.change(screen.getByLabelText("单元格地址"), { target: { value: "C10" } })
		fireEvent.keyDown(screen.getByLabelText("单元格地址"), { key: "Enter" })
		fireEvent.click(screen.getByRole("button", { name: "删除选中行" }))
		await waitFor(() => expect(state.session!.rows.find((row) => row.id === "far")?.sheetRowNumber).toBe(19))
		const operations = rpc.operation.mock.calls.map(([call]) => JSON.parse(call.value).operation)
		const deletedAt = operations.findIndex((op) => op.action === "delete_visual_rows")
		expect(deletedAt).toBeGreaterThan(0)
		expect(operations.slice(0, deletedAt).some((op) => op.action === "edit_state" && op.editing === false)).toBe(true)
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
	it("starts editing from a printable key, saves with Enter and moves to the next visual row", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("gridcell", { name: "C3" }))
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C3")
		expect(rpc.operation).not.toHaveBeenCalled()
		fireEvent.keyDown(grid, { key: "新" })
		expect(screen.getByLabelText("C3 格内编辑")).toHaveValue("新")
		fireEvent.change(screen.getByLabelText("C3 格内编辑"), { target: { value: "新内容" } })
		fireEvent.keyDown(screen.getByLabelText("C3 格内编辑"), { key: "Enter" })
		await waitFor(() => expect(state.session!.rows[1].values.text).toBe("新内容"))
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C4")
		expect(rpc.operation.mock.calls.filter(([call]) => JSON.parse(call.value).operation.action === "write")).toHaveLength(1)
	})
	it("keeps the focused input node through Chinese IME composition and only saves after a later Enter", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const capture = screen.getByLabelText("C2 键盘输入") as HTMLTextAreaElement
		fireEvent.focus(capture)
		fireEvent.keyDown(capture, { key: "Process" })
		fireEvent.compositionStart(capture, { data: "" })
		const input = screen.getByLabelText("C2 格内编辑") as HTMLTextAreaElement
		expect(input).toBe(capture)
		fireEvent.change(input, { target: { value: "ni" } })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(screen.getByLabelText("C2 格内编辑")).toHaveValue("ni")
		expect(rpc.operation.mock.calls.filter(([call]) => JSON.parse(call.value).operation.action === "write")).toHaveLength(0)
		fireEvent.change(input, { target: { value: "你好" } })
		fireEvent.compositionEnd(input, { data: "你好" })
		fireEvent.keyDown(input, { key: "Enter" })
		expect(screen.getByLabelText("C2 格内编辑")).toHaveValue("你好")
		await new Promise((resolve) => setTimeout(resolve, 5))
		fireEvent.keyDown(input, { key: "Enter" })
		await waitFor(() => expect(state.session!.rows[0].values.text).toBe("你好"))
	})
	it("starts plain text editing from the active cell keyboard capture", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const capture = screen.getByLabelText("C2 键盘输入") as HTMLTextAreaElement
		fireEvent.keyDown(capture, { key: "A" })
		expect(screen.getByLabelText("C2 格内编辑")).toBe(capture)
		expect(screen.getByLabelText("C2 格内编辑")).toHaveValue("A")
	})
	it("waits for an acknowledged edit lease before sending an in-cell write", async () => {
		const original = rpc.operation.getMockImplementation()!
		let grantLease!: () => void
		rpc.operation.mockImplementation((call) => {
			const op = JSON.parse(call.value).operation
			if (op.action === "edit_state" && op.editing)
				return new Promise((resolve) => {
					grantLease = () => resolve(original(call))
				})
			return original(call)
		})
		render(<BatchWorksheet panelId="panel-1" taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		fireEvent.change(screen.getByLabelText("C2 格内编辑"), { target: { value: "锁保护输入" } })
		fireEvent.keyDown(screen.getByLabelText("C2 格内编辑"), { key: "Enter" })
		await waitFor(() => expect(grantLease).toBeTypeOf("function"))
		expect(rpc.operation.mock.calls.some(([call]) => JSON.parse(call.value).operation.action === "write")).toBe(false)
		await act(async () => grantLease())
		await waitFor(() => expect(state.session!.rows[0].values.text).toBe("锁保护输入"))
		const operations = rpc.operation.mock.calls.map(([call]) => JSON.parse(call.value).operation)
		expect(operations.findIndex((op) => op.action === "edit_state" && op.editing)).toBeLessThan(
			operations.findIndex((op) => op.action === "write"),
		)
	})
	it("answers a paid-run draft probe from the synchronous edit-intent ref", async () => {
		const posted = vi.spyOn(PLATFORM_CONFIG, "postMessage").mockImplementation(() => {})
		try {
			render(<BatchWorksheet panelId="panel-1" taskId="same-task" />)
			await screen.findByRole("grid")
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "batch_table_draft_probe", panelId: "panel-1", requestId: "clean" },
				}),
			)
			expect(posted).toHaveBeenCalledWith({
				type: "batch_table_draft_probe_response",
				panelId: "panel-1",
				requestId: "clean",
				dirty: false,
			})
			posted.mockClear()
			const capture = screen.getByLabelText("C2 键盘输入")
			fireEvent.keyDown(capture, { key: "A" })
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "batch_table_draft_probe", panelId: "panel-1", requestId: "dirty" },
				}),
			)
			expect(posted).toHaveBeenCalledWith({
				type: "batch_table_draft_probe_response",
				panelId: "panel-1",
				requestId: "dirty",
				dirty: true,
			})
			posted.mockClear()
			window.dispatchEvent(
				new MessageEvent("message", {
					data: { type: "batch_table_draft_probe", panelId: "someone-else", requestId: "ignored" },
				}),
			)
			expect(posted).not.toHaveBeenCalled()
		} finally {
			posted.mockRestore()
		}
	})
	it("protects a dirty formula-bar value before its write, and keeps the lease while hidden", async () => {
		const original = rpc.operation.getMockImplementation()!
		let grantLease!: () => void
		rpc.operation.mockImplementation((call) => {
			const op = JSON.parse(call.value).operation
			if (op.action === "edit_state" && op.editing)
				return new Promise((resolve) => {
					grantLease = () => resolve(original(call))
				})
			return original(call)
		})
		const panel = render(<BatchWorksheet panelId="panel-1" taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格内容"), { target: { value: "公式栏草稿" } })
		fireEvent.keyDown(screen.getByLabelText("单元格内容"), { key: "Enter" })
		await waitFor(() => expect(grantLease).toBeTypeOf("function"))
		expect(rpc.operation.mock.calls.some(([call]) => JSON.parse(call.value).operation.action === "write")).toBe(false)
		panel.unmount()
		expect(
			rpc.operation.mock.calls.some(([call]) => {
				const op = JSON.parse(call.value).operation
				return op.action === "edit_state" && op.editing === false
			}),
		).toBe(false)
	})
	it("keeps the draft and never writes when edit-lease acquisition fails", async () => {
		const original = rpc.operation.getMockImplementation()!
		rpc.operation.mockImplementation((call) => {
			if (JSON.parse(call.value).operation.action === "edit_state") throw new Error("编辑保护不可用")
			return original(call)
		})
		render(<BatchWorksheet panelId="panel-1" taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		fireEvent.change(screen.getByLabelText("C2 格内编辑"), { target: { value: "安全草稿" } })
		fireEvent.keyDown(screen.getByLabelText("C2 格内编辑"), { key: "Enter" })
		await screen.findByText(/1 个单元格草稿尚未确认保存/)
		expect(screen.getByText(/无法保护未保存的工作表输入/)).toBeInTheDocument()
		expect(rpc.operation.mock.calls.some(([call]) => JSON.parse(call.value).operation.action === "write")).toBe(false)
	})
	it("recovers text from an input event when an IME emits an unidentified key", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		const capture = screen.getByLabelText("C2 键盘输入") as HTMLTextAreaElement
		fireEvent.keyDown(capture, { key: "Unidentified" })
		fireEvent.input(capture, { target: { value: "中" } })
		expect(screen.getByLabelText("C2 格内编辑")).toBe(capture)
		expect(screen.getByLabelText("C2 格内编辑")).toHaveValue("中")
		expect(rpc.operation.mock.calls.filter(([call]) => JSON.parse(call.value).operation.action === "write")).toHaveLength(0)
	})
	it("commits an in-cell edit when clicking away and recovers the draft on a stale revision", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		fireEvent.change(screen.getByLabelText("C2 格内编辑"), { target: { value: "点击别格保存" } })
		fireEvent.blur(screen.getByLabelText("C2 格内编辑"))
		fireEvent.click(screen.getByRole("gridcell", { name: "D2" }))
		await waitFor(() => expect(state.session!.rows[0].values.text).toBe("点击别格保存"))
		expect(screen.getByLabelText("单元格地址")).toHaveValue("D2")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "D2" }))
		fireEvent.change(screen.getByLabelText("D2 格内编辑"), { target: { value: "冲突草稿" } })
		act(() => {
			state.session!.revision++
			state.session!.rows[0].values.goal = "Agent 更新的目标"
			publish()
		})
		fireEvent.keyDown(screen.getByLabelText("D2 格内编辑"), { key: "Enter" })
		await screen.findByText(/1 个单元格草稿尚未确认保存/)
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "D2" }))
		expect(screen.getByLabelText("D2 格内编辑")).toHaveValue("冲突草稿")
		expect(state.session!.rows[0].values.goal).toBe("Agent 更新的目标")
	})
	it("accepts the next cell while a save is pending and sends its write with the prior ACK revision", async () => {
		const original = rpc.operation.getMockImplementation()!
		let releaseFirst!: () => void
		rpc.operation.mockImplementation((call) => {
			const op = JSON.parse(call.value).operation
			if (op.action === "write" && op.range === "C2")
				return new Promise((resolve) => {
					releaseFirst = () => resolve(original(call))
				})
			return original(call)
		})
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		fireEvent.change(screen.getByLabelText("C2 格内编辑"), { target: { value: "第一格更新" } })
		fireEvent.keyDown(screen.getByLabelText("C2 格内编辑"), { key: "Enter" })
		await waitFor(() => expect(releaseFirst).toBeTypeOf("function"))
		fireEvent.keyDown(grid, { key: "新" })
		expect(screen.getByLabelText("C3 格内编辑")).toHaveValue("新")
		fireEvent.change(screen.getByLabelText("C3 格内编辑"), { target: { value: "第二格更新" } })
		fireEvent.keyDown(screen.getByLabelText("C3 格内编辑"), { key: "Enter" })
		expect(screen.getByText(/正在保存 2 个单元格/)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "检查输入" })).toBeDisabled()
		await act(async () => releaseFirst())
		await waitFor(() => expect(state.session!.rows[1].values.text).toBe("第二格更新"))
		const writes = rpc.operation.mock.calls
			.map(([call]) => JSON.parse(call.value).operation)
			.filter((op) => op.action === "write")
		expect(writes.map((op) => [op.range, op.revision])).toEqual([
			["C2", 5],
			["C3", 6],
		])
		expect(screen.queryByText(/单元格草稿尚未确认保存/)).not.toBeInTheDocument()
	})
	it("stops later queued writes after a conflict and keeps every unsaved draft", async () => {
		const original = rpc.operation.getMockImplementation()!
		let failFirst!: () => void
		rpc.operation.mockImplementation((call) => {
			const op = JSON.parse(call.value).operation
			if (op.action === "write" && op.range === "C2")
				return new Promise((_resolve, reject) => {
					failFirst = () => reject(new Error("输入已被更新"))
				})
			return original(call)
		})
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		fireEvent.change(screen.getByLabelText("C2 格内编辑"), { target: { value: "草稿一" } })
		fireEvent.keyDown(screen.getByLabelText("C2 格内编辑"), { key: "Enter" })
		await waitFor(() => expect(failFirst).toBeTypeOf("function"))
		fireEvent.keyDown(grid, { key: "二" })
		fireEvent.change(screen.getByLabelText("C3 格内编辑"), { target: { value: "草稿二" } })
		fireEvent.keyDown(screen.getByLabelText("C3 格内编辑"), { key: "Enter" })
		await act(async () => failFirst())
		await screen.findByText(/2 个单元格草稿尚未确认保存/)
		expect(screen.getByRole("button", { name: "检查输入" })).toBeDisabled()
		const writes = rpc.operation.mock.calls
			.map(([call]) => JSON.parse(call.value).operation)
			.filter((op) => op.action === "write")
		expect(writes.map((op) => op.range)).toEqual(["C2"])
		expect(state.session!.rows[0].values.text).toBe("第一条")
		expect(state.session!.rows[1].values.text).toBe("第二条")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C3" }))
		expect(screen.getByLabelText("C3 格内编辑")).toHaveValue("草稿二")
	})
	it("F2 edits in place, Escape cancels, and Tab moves through inputs then wraps", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.keyDown(grid, { key: "F2" })
		expect(screen.getByLabelText("C2 格内编辑")).toHaveValue("第一条")
		fireEvent.change(screen.getByLabelText("C2 格内编辑"), { target: { value: "不保存" } })
		fireEvent.keyDown(screen.getByLabelText("C2 格内编辑"), { key: "Escape" })
		expect(screen.getByRole("gridcell", { name: "C2" })).toHaveTextContent("第一条")
		fireEvent.keyDown(grid, { key: "Tab" })
		expect(screen.getByLabelText("单元格地址")).toHaveValue("D2")
		fireEvent.keyDown(grid, { key: "Tab" })
		expect(screen.getByLabelText("单元格地址")).toHaveValue("E2")
		fireEvent.keyDown(grid, { key: "Tab" })
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C3")
		expect(rpc.operation.mock.calls.filter(([call]) => JSON.parse(call.value).operation.action === "write")).toHaveLength(0)
	})
	it("keeps only the latest rapid selection for host synchronization", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("gridcell", { name: "C2" }))
		fireEvent.click(screen.getByRole("gridcell", { name: "D2" }))
		fireEvent.click(screen.getByRole("gridcell", { name: "C3" }))
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C3")
		expect(rpc.operation).not.toHaveBeenCalled()
		await waitFor(() => expect(rpc.operation).toHaveBeenCalledTimes(1))
		expect(JSON.parse(rpc.operation.mock.calls[0][0].value).operation.range).toBe("C3")
	})
	it("coalesces selection updates while an earlier host action is still pending", async () => {
		const original = rpc.operation.getMockImplementation()!
		let releaseCopy!: () => void
		rpc.operation.mockImplementation((call) => {
			if (JSON.parse(call.value).operation.action === "copy")
				return new Promise((resolve) => {
					releaseCopy = () => resolve(original(call))
				})
			return original(call)
		})
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("button", { name: "复制选区" }))
		await waitFor(() => expect(releaseCopy).toBeTypeOf("function"))
		fireEvent.click(screen.getByRole("gridcell", { name: "C3" }))
		await new Promise((resolve) => setTimeout(resolve, 135))
		fireEvent.click(screen.getByRole("gridcell", { name: "D3" }))
		await new Promise((resolve) => setTimeout(resolve, 135))
		expect(screen.getByLabelText("单元格地址")).toHaveValue("D3")
		expect(rpc.operation).toHaveBeenCalledTimes(1)
		await act(async () => releaseCopy())
		await waitFor(() => expect(rpc.operation).toHaveBeenCalledTimes(2))
		expect(JSON.parse(rpc.operation.mock.calls[1][0].value).operation.range).toBe("D3")
	})
	it("drags a rectangular selection locally without firing one host call per cell", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.mouseDown(screen.getByRole("gridcell", { name: "C2" }), { button: 0, buttons: 1 })
		fireEvent.mouseEnter(screen.getByRole("gridcell", { name: "D3" }), { buttons: 1 })
		fireEvent.mouseUp(window)
		fireEvent.click(screen.getByRole("gridcell", { name: "D3" }))
		expect(screen.getByLabelText("单元格地址")).toHaveValue("C2:D3")
		expect(screen.getByRole("gridcell", { name: "D3" })).toHaveAttribute("aria-selected", "true")
		await waitFor(() => expect(rpc.operation).toHaveBeenCalledTimes(1))
		expect(JSON.parse(rpc.operation.mock.calls[0][0].value).operation.range).toBe("C2:D3")
	})
	it("writes into visual row 20 without creating paid rows 4 through 19", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格地址"), { target: { value: "C20" } })
		fireEvent.keyDown(screen.getByLabelText("单元格地址"), { key: "Enter" })
		fireEvent.click(await screen.findByRole("gridcell", { name: "C20" }))
		fireEvent.keyDown(grid, { key: "字" })
		expect(screen.getByLabelText("C20 格内编辑")).toHaveValue("字")
		fireEvent.keyDown(screen.getByLabelText("C20 格内编辑"), { key: "Enter" })
		await waitFor(() => expect(state.session!.rows.find((row) => row.sheetRowNumber === 20)?.values.text).toBe("字"))
		expect(state.session!.rows).toHaveLength(3)
		expect(screen.getByRole("gridcell", { name: "C20" })).toHaveTextContent("字")
		expect(screen.getByText("3 条任务")).toBeInTheDocument()
	})
	it("pastes a rectangle from a distant blank visual row and keeps the gap uncharged", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格地址"), { target: { value: "C20" } })
		fireEvent.keyDown(screen.getByLabelText("单元格地址"), { key: "Enter" })
		fireEvent.paste(grid, { clipboardData: { getData: () => "远行一\t目标一\n远行二\t目标二" } })
		await waitFor(() => expect(state.session!.rows.find((row) => row.sheetRowNumber === 21)?.values.goal).toBe("目标二"))
		expect(state.session!.rows.map((row) => row.sheetRowNumber ?? 0)).toEqual([0, 0, 20, 21])
		expect(screen.getByText("4 条任务")).toBeInTheDocument()
	})
	it("allows the trusted file picker from an unmaterialized visual row", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.change(screen.getByLabelText("单元格地址"), { target: { value: "C20" } })
		fireEvent.keyDown(screen.getByLabelText("单元格地址"), { key: "Enter" })
		const fileButton = screen.getByRole("button", { name: "从文件导入文本" })
		expect(fileButton).not.toBeDisabled()
		fireEvent.click(fileButton)
		await waitFor(() =>
			expect(
				rpc.operation.mock.calls.some(([call]) => {
					const op = JSON.parse(call.value).operation
					return op.action === "attach" && op.range === "C20" && op.revision === 5
				}),
			).toBe(true),
		)
	})
	it("restores an unsaved in-cell edit after the worksheet Webview is suspended", async () => {
		const first = render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		fireEvent.change(screen.getByLabelText("C2 格内编辑"), { target: { value: "稍后继续" } })
		first.unmount()
		expect((webviewState.value as { inline?: { value: string } }).inline?.value).toBe("稍后继续")
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByLabelText("C2 格内编辑")).toHaveValue("稍后继续")
	})
	it("restores an in-flight write as a draft without silently replaying it", async () => {
		rpc.operation.mockImplementationOnce(() => new Promise(() => {}))
		const first = render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		fireEvent.change(screen.getByLabelText("C2 格内编辑"), { target: { value: "提交状态不明" } })
		fireEvent.keyDown(screen.getByLabelText("C2 格内编辑"), { key: "Enter" })
		await screen.findByText(/正在保存 1 个单元格/)
		first.unmount()
		expect((webviewState.value as { pendingInline?: { value: string }[] }).pendingInline?.[0].value).toBe("提交状态不明")
		const sent = rpc.operation.mock.calls.length
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByText(/1 个单元格草稿尚未确认保存/)
		expect(rpc.operation).toHaveBeenCalledTimes(sent)
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		expect(screen.getByLabelText("C2 格内编辑")).toHaveValue("提交状态不明")
	})
	it("distinguishes an untouched seed from an explicit default-valued task", async () => {
		state.session!.rows = [
			{ id: "seed", sheetRowNumber: 2, origin: "implicit", values: {}, attachments: [] },
			{ id: "default", sheetRowNumber: 5, origin: "explicit", values: {}, attachments: [] },
		]
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByText("1 条任务")).toBeInTheDocument()
		expect(screen.getByRole("gridcell", { name: "B5" })).toHaveTextContent("使用默认值")
		fireEvent.click(screen.getByRole("gridcell", { name: "C4" }))
		expect(screen.getByText(/空白视觉行，输入后才创建任务/)).toBeInTheDocument()
	})
	it("lets an image-only SkillBot attach to its real but nonbillable seed row", async () => {
		state.session!.rows = [{ id: "seed", sheetRowNumber: 2, origin: "implicit", values: {}, attachments: [] }]
		state.session!.listing!.schema!.fields = [{ key: "image", label: "图片", required: true, value_type: "asset_ref" }]
		render(<BatchWorksheet taskId="same-task" />)
		await screen.findByRole("grid")
		expect(screen.getByText("0 条任务")).toBeInTheDocument()
		expect(screen.getByRole("button", { name: "上传素材" })).not.toBeDisabled()
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "C2" }))
		expect(within(screen.getByRole("dialog")).getByRole("button", { name: "上传素材" })).not.toBeDisabled()
	})
	it("pastes a multiline rectangular range using the same input revision", async () => {
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.paste(grid, { clipboardData: { getData: () => '"原文第一行\n第二行"\t新目标\n原文二\t目标二' } })
		await waitFor(() => expect(state.session!.rows[0].values.text).toBe("原文第一行\n第二行"))
		expect(state.session!.rows[1].values.goal).toBe("目标二")
	})
	it("takes an edit lease before a direct grid paste", async () => {
		render(<BatchWorksheet panelId="panel-1" taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.paste(grid, { clipboardData: { getData: () => "粘贴改写" } })
		await waitFor(() => expect(state.session!.rows[0].values.text).toBe("粘贴改写"))
		const operations = rpc.operation.mock.calls.map(([call]) => JSON.parse(call.value).operation)
		expect(operations.findIndex((op) => op.action === "edit_state" && op.editing)).toBeLessThan(
			operations.findIndex((op) => op.action === "write"),
		)
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
	it("keeps boolean and enum fields in their schema-aware editor", async () => {
		state.session!.listing!.schema!.fields.push(
			{ key: "approved", label: "批准", value_type: "boolean" },
			{ key: "channel", label: "渠道", value_type: "string", enum_values: ["淘宝", "京东"] },
		)
		render(<BatchWorksheet taskId="same-task" />)
		const grid = await screen.findByRole("grid")
		fireEvent.click(screen.getByRole("gridcell", { name: "F2" }))
		fireEvent.keyDown(grid, { key: "真" })
		expect(screen.queryByLabelText("F2 格内编辑")).not.toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "F2 单元格详情" })).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "关闭单元格详情" }))
		fireEvent.doubleClick(screen.getByRole("gridcell", { name: "G2" }))
		expect(screen.queryByLabelText("G2 格内编辑")).not.toBeInTheDocument()
		expect(screen.getByRole("dialog", { name: "G2 单元格详情" })).toBeInTheDocument()
		expect(rpc.operation.mock.calls.filter(([call]) => JSON.parse(call.value).operation.action === "write")).toHaveLength(0)
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
