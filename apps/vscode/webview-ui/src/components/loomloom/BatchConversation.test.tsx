import type { BatchSession } from "@shared/loomloom"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ExtensionStateContext, type ExtensionStateContextType } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { BatchConversation } from "./BatchConversation"
import { fetchSkillBots, sendBatch } from "./batch-api"

vi.mock("./batch-api", () => ({
	sendBatch: vi.fn().mockResolvedValue(null),
	attachToRow: vi.fn().mockResolvedValue(null),
	fetchSkillBots: vi.fn().mockResolvedValue({ items: [], installedIds: [], pages: 1 }),
}))
vi.mock("@/services/grpc-client", () => ({
	AccountServiceClient: {
		shengSuanYunLoginClicked: vi.fn().mockResolvedValue({ value: "" }),
	},
	LoomLoomServiceClient: {
		batchModels: vi.fn().mockResolvedValue({ value: "[]" }),
		openBatchTable: vi.fn().mockResolvedValue({ value: "{}" }),
		batchTableAction: vi.fn().mockResolvedValue({ value: "{}" }),
	},
}))
const fixture = (): BatchSession => ({
	version: 1,
	id: "batch",
	taskId: "same-cline-session",
	enabled: true,
	revision: 4,
	phase: "collecting",
	events: [],
	results: [],
	artifacts: [],
	listing: {
		id: "listing",
		name: "文本扩写助手",
		description: "",
		versionId: "v1",
		availability: "available",
		schema: {
			schema_version: "loom_market_public_input_schema_v1",
			fields: [
				{ key: "text", label: "扩写原文", value_type: "string", required: true },
				{ key: "modelChoice", label: "模型", value_type: "string" },
			],
		},
	},
	rows: [
		{
			id: "row-1",
			values: { text: "第一条素材" },
			attachments: [{ id: "file-1", name: "商品说明.md", path: "/workspace/商品说明.md" }],
		},
		{ id: "row-2", values: { text: "第二条素材" }, attachments: [] },
	],
})
afterEach(() => {
	cleanup()
	vi.useRealTimers()
})
beforeEach(() => vi.clearAllMocks())
describe("Batch conversation controls", () => {
	it("reports local saving separately from the cloud run result", () => {
		const s = {
			...fixture(),
			phase: "completed" as const,
			outputSummary: { saved: 2, failed: 1 },
			attempt: { requestId: "r", runId: "run", quote: {} as NonNullable<BatchSession["quote"]> },
		}
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(screen.getByText(/已保存 2 个文本文件；1 个本地保存失败，云端结果仍保留/)).toBeInTheDocument()
		expect(screen.getByText("重试保存文件")).toBeInTheDocument()
		expect(screen.getByText(/这批任务已完成/)).toBeInTheDocument()
	})
	it("offers the previous SkillBot as the primary next-batch path and a separate switch", async () => {
		const s = fixture()
		s.phase = "completed"
		s.attempt = { requestId: "request", runId: "run", quote: {} as NonNullable<BatchSession["quote"]> }
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		fireEvent.click(screen.getByRole("button", { name: "沿用「文本扩写助手」开始下一批" }))
		await waitFor(() => expect(sendBatch).toHaveBeenCalledWith({ action: "newBatch", revision: 4 }, s.taskId))
		await waitFor(() => expect(screen.getByRole("button", { name: "改用其他 SkillBot" })).not.toBeDisabled())
		fireEvent.click(screen.getByRole("button", { name: "改用其他 SkillBot" }))
		await waitFor(() =>
			expect(sendBatch).toHaveBeenCalledWith({ action: "newBatch", revision: 4, keepListing: false }, s.taskId),
		)
	})
	it("offers a guarded way to reselect the workflow without immediately clearing inputs", async () => {
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={fixture()} />)
		fireEvent.click(screen.getByText("重新选择工作流"))
		expect(screen.getByRole("dialog", { name: "重新选择工作流确认" })).toBeInTheDocument()
		expect(sendBatch).not.toHaveBeenCalled()
		fireEvent.click(screen.getByText("保留当前输入"))
		expect(sendBatch).not.toHaveBeenCalled()
		fireEvent.click(screen.getByText("重新选择工作流"))
		fireEvent.click(screen.getByText("确认清空并重新选择"))
		await waitFor(() =>
			expect(sendBatch).toHaveBeenCalledWith({ action: "newBatch", revision: 4, keepListing: false }, "same-cline-session"),
		)
	})
	it("keeps the Cline reply style without exposing a separate Batch or debug panel", () => {
		const s = fixture()
		s.agentContext = { revision: 4, phase: "collecting", preparedAt: Date.now() }
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(screen.getByText("Cline Chinese")).toBeInTheDocument()
		expect(screen.queryByText("Batch", { exact: true })).not.toBeInTheDocument()
		expect(screen.queryByText("当前 Cline 任务")).not.toBeInTheDocument()
		expect(screen.queryByText("Agent 会话连接")).not.toBeInTheDocument()
		expect(screen.queryByText(/same-cline-session|输入版本|最近上下文版本/)).not.toBeInTheDocument()
		expect(screen.getByText("2 行输入均通过了必填项和格式检查，接下来请逐行核对内容。")).toBeInTheDocument()
		expect(screen.getByText(/核对每条任务的材料与要求；之后再查看预算/)).toBeInTheDocument()
		expect(screen.getByRole("article", { name: "Cline Batch 工作流" })).toHaveClass("batch-conversation")
	})
	it("guides empty rows honestly instead of claiming the inputs are complete", () => {
		const s = fixture()
		s.rows = s.rows.map((row) => ({ ...row, values: {}, attachments: [] }))
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(screen.getByText("当前有 2 行任务，输入还没有填写。")).toBeInTheDocument()
		expect(screen.getByText(/第 1 条缺少「扩写原文」/)).toBeInTheDocument()
		expect(screen.queryByText(/均通过了必填项/)).not.toBeInTheDocument()
	})
	it("expires the quote in place, without requiring an unrelated rerender", () => {
		vi.useFakeTimers()
		vi.setSystemTime(1_000_000)
		const s = fixture()
		s.phase = "quoted"
		s.quote = {
			id: "expiring",
			revision: 4,
			hash: "h",
			inputRows: [],
			versionId: "v1",
			payable: { amount: "1.0000000", currency: "CNY" },
			taskCount: 2,
			at: Date.now() - 599_999,
			valid: true,
		}
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(screen.getByText("确认并运行")).toBeInTheDocument()
		act(() => vi.advanceTimersByTime(2))
		expect(screen.queryByText("确认并运行")).not.toBeInTheDocument()
		expect(screen.getByText("返回修改")).toBeInTheDocument()
		expect(screen.getByText("旧预算已失效")).toBeInTheDocument()
		expect(sendBatch).not.toHaveBeenCalled()
	})
	it("formats marketplace fees without changing the raw price", async () => {
		const s = fixture()
		s.phase = "selecting"
		s.rows = []
		s.listing = undefined
		const item = { ...fixture().listing!, fee: { amount: "4.0000000", currency: "CNY" } }
		vi.mocked(fetchSkillBots).mockResolvedValueOnce({ items: [item], installedIds: [item.id], pages: 1 })
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(await screen.findByText("已安装 · 4 CNY / 任务")).toBeInTheDocument()
		expect(screen.getByText("选择")).toBeInTheDocument()
		expect(item.fee.amount).toBe("4.0000000")
	})
	it("guides a first-time Batch user to the existing ShengSuanYun login instead of showing an empty install list", async () => {
		const s = fixture()
		s.phase = "selecting"
		s.rows = []
		s.listing = undefined
		vi.mocked(fetchSkillBots).mockResolvedValueOnce({ items: [], installedIds: [], pages: 1, authRequired: true })
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(await screen.findByText(/使用 LoomLoom Batch 前，请先登录胜算云/)).toBeInTheDocument()
		expect(screen.queryByText(/暂无已安装的工作流/)).not.toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "登录胜算云" }))
		await waitFor(() => expect(AccountServiceClient.shengSuanYunLoginClicked).toHaveBeenCalled())
		fireEvent.click(screen.getByRole("button", { name: "已完成登录，刷新工作流" }))
		await waitFor(() => expect(fetchSkillBots).toHaveBeenCalledTimes(2))
	})
	it("places login in the Batch card even when a model API key exists but the account is signed out", async () => {
		const s = fixture()
		s.phase = "selecting"
		s.rows = []
		s.listing = undefined
		const view = (signedIn: boolean) => (
			<ExtensionStateContext.Provider
				value={{ loomLoomCredentialAvailable: true, loomLoomSignedIn: signedIn } as ExtensionStateContextType}>
				<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />
			</ExtensionStateContext.Provider>
		)
		const { rerender } = render(view(false))
		const card = screen.getByRole("article", { name: "Cline Batch 工作流" })
		expect(card).toContainElement(screen.getByRole("button", { name: "登录胜算云" }))
		expect(screen.getByText(/创作自己的 SkillBot，申请发布到市场/)).toBeInTheDocument()
		expect(screen.queryByText(/暂无已安装的工作流/)).not.toBeInTheDocument()
		expect(fetchSkillBots).not.toHaveBeenCalled()
		fireEvent.click(screen.getByRole("button", { name: "登录胜算云" }))
		await waitFor(() => expect(AccountServiceClient.shengSuanYunLoginClicked).toHaveBeenCalledOnce())
		rerender(view(true))
		await waitFor(() => expect(fetchSkillBots).toHaveBeenCalledOnce())
		expect(screen.queryByRole("button", { name: "登录胜算云" })).not.toBeInTheDocument()
	})
	it("refreshes the Batch catalog after the existing auth callback updates the user", async () => {
		const s = fixture()
		s.phase = "selecting"
		s.rows = []
		s.listing = undefined
		const item = fixture().listing!
		vi.mocked(fetchSkillBots)
			.mockResolvedValueOnce({ items: [], installedIds: [], pages: 1, authRequired: true })
			.mockResolvedValueOnce({ items: [item], installedIds: [item.id], pages: 1, authRequired: false })
		const view = (credentialAvailable?: boolean) => (
			<ExtensionStateContext.Provider
				value={{ loomLoomCredentialAvailable: credentialAvailable } as ExtensionStateContextType}>
				<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />
			</ExtensionStateContext.Provider>
		)
		const { rerender } = render(view())
		expect(await screen.findByRole("button", { name: "登录胜算云" })).toBeInTheDocument()
		rerender(view(true))
		expect(await screen.findByRole("button", { name: "选择" })).toBeInTheDocument()
		expect(screen.queryByRole("button", { name: "登录胜算云" })).not.toBeInTheDocument()
	})
	it("formats quote presentation but preserves the confirmed quote payload", async () => {
		const s = fixture()
		s.phase = "quoted"
		s.quote = {
			id: "confirmed-price",
			revision: 4,
			hash: "h",
			inputRows: [],
			versionId: "v1",
			payable: { amount: "6.9900000", currency: "CNY" },
			taskCount: 2,
			at: Date.now(),
			valid: true,
		}
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(screen.getByText("2 个任务 · 预计应付 6.99 CNY")).toBeInTheDocument()
		fireEvent.click(screen.getByText("确认并运行"))
		await waitFor(() =>
			expect(sendBatch).toHaveBeenCalledWith(
				{ action: "execute", revision: 4, quoteId: "confirmed-price" },
				"same-cline-session",
			),
		)
		expect(s.quote.payable.amount).toBe("6.9900000")
	})
	it("adds rows after selection without an upfront quantity gate", async () => {
		const s = fixture()
		s.rows = s.rows.slice(0, 1)
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(screen.queryByText("本次想批量生成多少个？")).not.toBeInTheDocument()
		expect(screen.queryByRole("table")).not.toBeInTheDocument()
		fireEvent.click(screen.getByText("+ 新增一行"))
		expect(sendBatch).toHaveBeenCalledWith({ action: "addRows", count: 1, revision: 4 }, "same-cline-session")
		await waitFor(() => expect(screen.getByText("+ 新增一行")).not.toBeDisabled())
	})
	it("moves the table out of chat but retains guided editing and filenames", async () => {
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={fixture()} />)
		expect(screen.queryByRole("table")).not.toBeInTheDocument()
		expect(screen.getByText("打开 Batch 工作表")).toBeInTheDocument()
		fireEvent.click(screen.getByText("逐条填写 2 条"))
		expect(screen.getByText(/商品说明.md/)).toBeInTheDocument()
		fireEvent.change(screen.getByLabelText("扩写原文 *"), { target: { value: "修改第一条" } })
		fireEvent.click(screen.getByText("保存本条"))
		await waitFor(() =>
			expect(sendBatch).toHaveBeenCalledWith(
				{ action: "patch", revision: 4, rows: [{ id: "row-1", values: { text: "修改第一条" } }] },
				"same-cline-session",
			),
		)
	})
	it("keeps default model as a selector and routes chat/files to the current Cline handler", async () => {
		const chat = vi.fn().mockResolvedValue(undefined)
		render(<BatchConversation onChat={chat} onMarket={vi.fn()} session={fixture()} />)
		fireEvent.click(screen.getByText("逐条填写 2 条"))
		expect(screen.getByRole("combobox", { name: "模型" })).toHaveValue("")
		fireEvent.click(screen.getByText("在聊天中整理"))
		expect(chat).toHaveBeenCalledWith(expect.stringContaining("当前 SkillBot"), ["/workspace/商品说明.md"])
		await waitFor(() => expect(screen.getByText("在聊天中整理")).not.toBeDisabled())
	})
	it("does not offer paid execution for invalidated quotes", async () => {
		const s = fixture()
		s.phase = "reviewing"
		s.quote = {
			id: "old",
			revision: 3,
			hash: "old",
			inputRows: [],
			versionId: "v1",
			payable: { amount: "0.3", currency: "CNY" },
			taskCount: 2,
			at: Date.now(),
			valid: false,
		}
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(screen.getByText("旧预算已失效")).toBeInTheDocument()
		expect(screen.queryByText("确认并运行")).not.toBeInTheDocument()
		fireEvent.click(screen.getByText("确认输入并查看预算"))
		expect(sendBatch).toHaveBeenCalledWith({ action: "quote", revision: 4 }, "same-cline-session")
		await waitFor(() => expect(screen.getByText("确认输入并查看预算")).not.toBeDisabled())
	})
	it("shows compact run progress instead of placing outputs in chat", () => {
		const s = fixture()
		s.phase = "partial-failure"
		s.attempt = { requestId: "request", runId: "run", quote: {} as NonNullable<BatchSession["quote"]> }
		s.results = [{ rowIndex: 1, status: "failed", errorMessage: "模型暂不可用" }]
		s.progress = { status: "partially_failed", total: 2, completed: 1, failed: 1 }
		render(<BatchConversation onChat={vi.fn()} onMarket={vi.fn()} session={s} />)
		expect(screen.queryByText("模型暂不可用")).not.toBeInTheDocument()
		expect(screen.getByText(/部分失败 · 成功 1\/2 · 失败 1/)).toBeInTheDocument()
		expect(screen.getByRole("progressbar")).toHaveAttribute("value", "2")
	})
})
