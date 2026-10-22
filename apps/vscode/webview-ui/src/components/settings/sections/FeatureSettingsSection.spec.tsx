import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import FeatureSettingsSection from "./FeatureSettingsSection"

const mockUpdateSetting = vi.fn()
const mockExtensionState = vi.hoisted(() => ({
	value: {
		enableCheckpointsSetting: true,
		hooksEnabled: false,
		showFeatureTips: false,
		mcpDisplayMode: "rich",
		useAutoCondense: false,
		compactionStrategy: "basic",
		subagentsEnabled: false,
		worktreesEnabled: { user: true, featureFlag: true },
		remoteConfigSettings: {},
		backgroundEditEnabled: false,
	},
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: vi.fn(() => mockExtensionState.value),
}))

vi.mock("@/components/settings/utils/settingsHandlers", () => ({
	updateSetting: (...args: unknown[]) => mockUpdateSetting(...args),
}))

const mockUpdateChinesePromoState = vi.fn()
vi.mock("@/services/grpc-client", () => ({
	StateServiceClient: {
		updateChinesePromoState: (...args: unknown[]) => {
			mockUpdateChinesePromoState(...args)
			return Promise.resolve({})
		},
	},
}))

describe("FeatureSettingsSection", () => {
	beforeEach(() => {
		mockUpdateSetting.mockClear()
		mockExtensionState.value = {
			...mockExtensionState.value,
			useAutoCondense: false,
			compactionStrategy: "basic",
		}
	})

	it("renders Hooks feature toggle", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("钩子")).toBeTruthy()

		const advancedSection = container.querySelector("#advanced-features")
		const agentSection = container.querySelector("#agent-features")

		expect(advancedSection?.querySelector("#hooks-setting-control")).toBeTruthy()
		expect(agentSection?.querySelector("#hooks-setting-control")).toBeNull()
	})

	it("renders Feature Tips toggle in the Editor section", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("功能提示")).toBeTruthy()

		const editorSection = container.querySelector("#optional-features")
		const agentSection = container.querySelector("#agent-features")

		expect(editorSection?.querySelector("#show-feature-tips-setting-control")).toBeTruthy()
		expect(agentSection?.querySelector("#show-feature-tips-setting-control")).toBeNull()
	})

	it("renders the Auto Compact Strategy setting in the Agent section", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		expect(screen.getByText("自动压缩策略")).toBeTruthy()

		const agentSection = container.querySelector("#agent-features")
		expect(agentSection?.textContent).toContain("基础")
	})

	it("disables Auto Compact Strategy when Auto Compact is off", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const strategySelect = container.querySelector("#agent-features button[role='combobox']")
		expect(strategySelect).toHaveAttribute("disabled")
	})

	it("calls updateSetting with hooksEnabled when toggled", () => {
		render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		fireEvent.click(screen.getByRole("switch", { name: "钩子" }))

		expect(mockUpdateSetting).toHaveBeenCalledWith("hooksEnabled", true)
	})

	it("calls updateSetting with showFeatureTips when toggled", () => {
		render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		fireEvent.click(screen.getByRole("switch", { name: "功能提示" }))

		expect(mockUpdateSetting).toHaveBeenCalledWith("showFeatureTips", true)
	})

	it("toggles the daily popup setting from the Notifications section", () => {
		const { container } = render(<FeatureSettingsSection renderSectionHeader={() => null} />)

		const notificationSection = container.querySelector("#notification-features")
		expect(notificationSection).toBeTruthy()

		fireEvent.click(screen.getByRole("switch", { name: "每日弹窗" }))

		expect(mockUpdateChinesePromoState).toHaveBeenCalledWith({ dailyPopupEnabled: false })
	})
})
