import { act, fireEvent, render, screen } from "@testing-library/react"
import type { ChangeEventHandler, KeyboardEventHandler, ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { ApiKeyField, type ApiKeyFieldOption } from "./ApiKeyField"

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, href }: { children?: ReactNode; href?: string }) => <a href={href}>{children}</a>,
	VSCodeTextField: ({
		children,
		onBlur,
		onFocus,
		onInput,
		onKeyDown,
		placeholder,
		value,
	}: {
		children?: ReactNode
		onBlur?: () => void
		onFocus?: () => void
		onInput?: ChangeEventHandler<HTMLInputElement>
		onKeyDown?: KeyboardEventHandler<HTMLInputElement>
		placeholder?: string
		value?: string
	}) => (
		<div>
			<input
				onBlur={onBlur}
				onChange={onInput}
				onFocus={onFocus}
				onKeyDown={onKeyDown}
				placeholder={placeholder}
				value={value}
			/>
			{children}
		</div>
	),
}))

async function flushDebounce() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 150))
	})
}

const options: ApiKeyFieldOption[] = [
	{ id: "personal", label: "个人账户 API Key", value: "" },
	{ id: "ent-1", label: "企业 A / 项目 / Key 1", value: "sk-enterprise-1" },
	{ id: "ent-2", label: "企业 A / 项目 / Key 2（已过期）", value: "sk-enterprise-2", disabled: true },
]

describe("ApiKeyField", () => {
	it("keeps the plain text input behavior when no key options are provided", async () => {
		const onChange = vi.fn()
		render(<ApiKeyField initialValue="" onChange={onChange} providerName="胜算云" />)

		expect(screen.queryByRole("button", { name: /可选的 API 密钥/ })).not.toBeInTheDocument()

		fireEvent.change(screen.getByPlaceholderText("输入 API 密钥..."), { target: { value: "typed-key" } })
		await flushDebounce()

		expect(onChange).toHaveBeenCalledWith("typed-key")
	})

	it("opens the key list and reports the picked option instead of the typed value", async () => {
		const onChange = vi.fn()
		const onSelect = vi.fn()
		render(
			<ApiKeyField
				initialValue="personal-key"
				keyOptions={{ options, onSelect, value: "" }}
				onChange={onChange}
				providerName="胜算云"
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "展开可选的 API 密钥" }))
		expect(screen.getByRole("listbox")).toBeInTheDocument()
		expect(screen.getByRole("option", { name: "个人账户 API Key" })).toBeInTheDocument()

		fireEvent.click(screen.getByRole("option", { name: "企业 A / 项目 / Key 1" }))

		expect(onSelect).toHaveBeenCalledWith("sk-enterprise-1", options[1])
		expect(onChange).not.toHaveBeenCalled()
		expect(screen.getByPlaceholderText("输入 API 密钥...")).toHaveValue("sk-enterprise-1")
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
	})

	it("ignores disabled options", () => {
		const onSelect = vi.fn()
		render(
			<ApiKeyField
				initialValue="personal-key"
				keyOptions={{ options, onSelect }}
				onChange={vi.fn()}
				providerName="胜算云"
			/>,
		)

		fireEvent.click(screen.getByRole("button", { name: "展开可选的 API 密钥" }))
		fireEvent.click(screen.getByRole("option", { name: "企业 A / 项目 / Key 2（已过期）" }))

		expect(onSelect).not.toHaveBeenCalled()
	})

	it("shows loading, error and hint text below the field", () => {
		const { rerender } = render(
			<ApiKeyField
				initialValue=""
				keyOptions={{ options: [], loading: true, loadingText: "正在加载企业账户 API Key..." }}
				onChange={vi.fn()}
				providerName="胜算云"
			/>,
		)
		expect(screen.getByText("正在加载企业账户 API Key...")).toBeInTheDocument()

		rerender(
			<ApiKeyField
				initialValue=""
				keyOptions={{ options: [], error: "获取企业账户 API Key 失败" }}
				onChange={vi.fn()}
				providerName="胜算云"
			/>,
		)
		expect(screen.getByRole("alert")).toHaveTextContent("获取企业账户 API Key 失败")

		rerender(
			<ApiKeyField
				initialValue=""
				keyOptions={{ options, hint: "可从已关联的企业账户 API Key 中快速切换。" }}
				onChange={vi.fn()}
				providerName="胜算云"
			/>,
		)
		expect(screen.getByText("可从已关联的企业账户 API Key 中快速切换。")).toBeInTheDocument()
	})

	it("closes the key list with Escape", () => {
		render(<ApiKeyField initialValue="personal-key" keyOptions={{ options }} onChange={vi.fn()} providerName="胜算云" />)

		fireEvent.click(screen.getByRole("button", { name: "展开可选的 API 密钥" }))
		expect(screen.getByRole("listbox")).toBeInTheDocument()

		fireEvent.keyDown(screen.getByPlaceholderText("输入 API 密钥..."), { key: "Escape" })
		expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
	})
})
