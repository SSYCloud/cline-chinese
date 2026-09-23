import type { BatchField } from "@shared/loomloom"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { BatchFieldEditor } from "./BatchFieldEditor"

const rpc = vi.hoisted(() => ({ models: vi.fn() }))
vi.mock("@/services/grpc-client", () => ({ LoomLoomServiceClient: { batchModels: rpc.models } }))
vi.mock("./batch-api", () => ({ attachToRow: vi.fn(), sendBatch: vi.fn() }))
const textField: BatchField = {
	key: "text_model",
	label: "文本模型",
	description: "留空使用平台当前默认文本模型。",
	presentation: {},
	value_type: "string",
}
const catalog = [
	{ id: "provider/text-fast", name: "Fast text" },
	{ id: "provider/text-pro", name: "Pro text" },
]
beforeEach(() => {
	vi.clearAllMocks()
	rpc.models.mockResolvedValue({ value: JSON.stringify(catalog) })
})
afterEach(cleanup)
describe("Batch supported-model selector", () => {
	it("loads the real-shaped public text_model field even without model_override", async () => {
		const change = vi.fn()
		render(<BatchFieldEditor field={textField} onChange={change} taskId="same-task" value="" />)
		expect(await screen.findByRole("option", { name: "Fast text — provider/text-fast" })).toBeInTheDocument()
		expect(rpc.models).toHaveBeenCalledWith({ value: JSON.stringify({ taskId: "same-task", field: "text_model" }) })
		expect(screen.getByRole("option", { name: "推荐默认 · 由 SkillBot 选择" })).toBeInTheDocument()
		fireEvent.change(screen.getByRole("combobox", { name: "文本模型" }), { target: { value: "provider/text-pro" } })
		expect(change).toHaveBeenCalledWith("provider/text-pro")
		fireEvent.change(screen.getByRole("combobox", { name: "文本模型" }), { target: { value: "" } })
		expect(change).toHaveBeenLastCalledWith("")
	})
	it("retains the recommended default and prevents refresh while loading", async () => {
		let resolve!: (v: { value: string }) => void
		rpc.models.mockImplementation(
			() =>
				new Promise((r) => {
					resolve = r
				}),
		)
		render(<BatchFieldEditor field={textField} onChange={vi.fn()} taskId="same-task" value="" />)
		expect(screen.getByRole("combobox")).toHaveValue("")
		expect(screen.getByRole("option", { name: "正在加载支持的模型…" })).toBeDisabled()
		expect(screen.getByText("刷新模型列表")).toBeDisabled()
		await act(async () => resolve({ value: JSON.stringify(catalog) }))
		expect(screen.getByText("刷新模型列表")).not.toBeDisabled()
	})
	it("shows a retry instead of silently degrading an API failure to one option", async () => {
		rpc.models.mockRejectedValueOnce(new Error("请重新登录胜算云"))
		render(<BatchFieldEditor field={textField} onChange={vi.fn()} taskId="same-task" value="" />)
		expect(await screen.findByRole("alert")).toHaveTextContent("请重新登录胜算云")
		expect(screen.getByRole("combobox")).toHaveValue("")
		fireEvent.click(screen.getByText("重试加载模型"))
		expect(await screen.findByRole("option", { name: "Pro text — provider/text-pro" })).toBeInTheDocument()
		expect(rpc.models).toHaveBeenCalledTimes(2)
	})
	it("honors explicit no-override metadata even for a known text field", () => {
		render(
			<BatchFieldEditor
				field={{
					...textField,
					model_override: { step_type: "text-generate", allow_override: false, default_model_id: "fixed-default" },
				}}
				onChange={vi.fn()}
				taskId="same-task"
				value=""
			/>,
		)
		expect(rpc.models).not.toHaveBeenCalled()
		expect(screen.getByRole("option", { name: "推荐默认 · fixed-default" })).toBeInTheDocument()
		expect(screen.queryByText("刷新模型列表")).not.toBeInTheDocument()
	})
	it("does not invent a modality for ambiguous model fields", () => {
		render(
			<BatchFieldEditor
				field={{ key: "model", label: "模型", value_type: "string" }}
				onChange={vi.fn()}
				taskId="same-task"
				value=""
			/>,
		)
		expect(rpc.models).not.toHaveBeenCalled()
		expect(screen.getByText(/未标明模型类型/)).toBeInTheDocument()
	})
	it("shows an empty catalog distinctly and can refresh it", async () => {
		rpc.models.mockResolvedValueOnce({ value: "[]" })
		render(<BatchFieldEditor field={textField} onChange={vi.fn()} taskId="same-task" value="" />)
		await waitFor(() => expect(screen.getByText(/当前没有可用的替代模型/)).toBeInTheDocument())
		fireEvent.click(screen.getByText("刷新模型列表"))
		expect(await screen.findByRole("option", { name: "Fast text — provider/text-fast" })).toBeInTheDocument()
	})
	it("retains public enum restrictions within the live catalog", async () => {
		render(
			<BatchFieldEditor
				field={{ ...textField, enum_values: ["provider/text-pro"] }}
				onChange={vi.fn()}
				taskId="same-task"
				value=""
			/>,
		)
		expect(await screen.findByRole("option", { name: "Pro text — provider/text-pro" })).toBeInTheDocument()
		expect(screen.queryByRole("option", { name: "Fast text — provider/text-fast" })).not.toBeInTheDocument()
	})
	it("ignores a late catalog response after switching fields", async () => {
		let resolve!: (v: { value: string }) => void
		rpc.models
			.mockImplementationOnce(
				() =>
					new Promise((r) => {
						resolve = r
					}),
			)
			.mockResolvedValueOnce({ value: JSON.stringify([{ id: "image-v1", name: "Image" }]) })
		const page = render(<BatchFieldEditor field={textField} onChange={vi.fn()} taskId="same-task" value="" />)
		page.rerender(
			<BatchFieldEditor
				field={{ key: "image_model", label: "图片模型", value_type: "string" }}
				onChange={vi.fn()}
				taskId="same-task"
				value=""
			/>,
		)
		expect(await screen.findByRole("option", { name: "Image — image-v1" })).toBeInTheDocument()
		await act(async () => resolve({ value: JSON.stringify(catalog) }))
		expect(screen.queryByRole("option", { name: "Fast text — provider/text-fast" })).not.toBeInTheDocument()
	})
})
