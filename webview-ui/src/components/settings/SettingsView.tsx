import { UnsavedChangesDialog } from "@/components/common/AlertDialog"
import HeroTooltip from "@/components/common/HeroTooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient } from "@/services/grpc-client"
import { cn } from "@/utils/cn"
import { validateApiConfiguration, validateModelId } from "@/utils/validate"
import { vscode } from "@/utils/vscode"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { EmptyRequest } from "@shared/proto/common"
import { PlanActMode, TogglePlanActModeRequest, UpdateSettingsRequest } from "@shared/proto/state"
import { VSCodeButton, VSCodeCheckbox, VSCodeLink, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react"
import { CheckCheck, FlaskConical, Info, LucideIcon, Settings, SquareMousePointer, SquareTerminal, Webhook } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState } from "react"
import { useEvent } from "react-use"
import { Tab, TabContent, TabHeader, TabList, TabTrigger } from "../common/Tab"
import { TabButton } from "../mcp/configuration/McpConfigurationView"
import ApiOptions from "./ApiOptions"
import BrowserSettingsSection from "./BrowserSettingsSection"
import FeatureSettingsSection from "./FeatureSettingsSection"
import PreferredLanguageSetting from "./PreferredLanguageSetting" // Added import
import Section from "./Section"
import SectionHeader from "./SectionHeader"
import TerminalSettingsSection from "./TerminalSettingsSection"
import { convertApiConfigurationToProtoApiConfiguration } from "@shared/proto-conversions/state/settings-conversion"
import { convertChatSettingsToProtoChatSettings } from "@shared/proto-conversions/state/chat-settings-conversion"
const { IS_DEV } = process.env

// Styles for the tab system
const settingsTabsContainer = "flex flex-1 overflow-hidden [&.narrow_.tab-label]:hidden"
const settingsTabList =
	"w-48 data-[compact=true]:w-12 flex-shrink-0 flex flex-col overflow-y-auto overflow-x-hidden border-r border-[var(--vscode-sideBar-background)]"
const settingsTabTrigger =
	"whitespace-nowrap overflow-hidden min-w-0 h-12 px-4 py-3 box-border flex items-center border-l-2 border-transparent text-[var(--vscode-foreground)] opacity-70 bg-transparent hover:bg-[var(--vscode-list-hoverBackground)] data-[compact=true]:w-12 data-[compact=true]:p-4 cursor-pointer"
const settingsTabTriggerActive =
	"opacity-100 border-l-2 border-l-[var(--vscode-focusBorder)] border-t-0 border-r-0 border-b-0 bg-[var(--vscode-list-activeSelectionBackground)]"

// Tab definitions
interface SettingsTab {
	id: string
	name: string
	tooltipText: string
	headerText: string
	icon: LucideIcon
}

export const SETTINGS_TABS: SettingsTab[] = [
	{
		id: "api-config",
		name: "API 配置",
		tooltipText: "API 配置",
		headerText: "API 配置",
		icon: Webhook,
	},
	{
		id: "general",
		name: "通用",
		tooltipText: "通用设置",
		headerText: "通用设置",
		icon: Settings,
	},
	{
		id: "features",
		name: "功能",
		tooltipText: "功能设置",
		headerText: "功能设置",
		icon: CheckCheck,
	},
	{
		id: "browser",
		name: "浏览器",
		tooltipText: "浏览器设置",
		headerText: "浏览器设置",
		icon: SquareMousePointer,
	},
	{
		id: "terminal",
		name: "终端",
		tooltipText: "终端设置",
		headerText: "终端设置",
		icon: SquareTerminal,
	},
	// Only show in dev mode
	...(IS_DEV
		? [
				{
					id: "debug",
					name: "调试",
					tooltipText: "调试工具",
					headerText: "调试",
					icon: FlaskConical,
				},
			]
		: []),
	{
		id: "about",
		name: "关于",
		tooltipText: "关于 Cline",
		headerText: "关于",
		icon: Info,
	},
]

type SettingsViewProps = {
	onDone: () => void
	targetSection?: string
}

const SettingsView = ({ onDone, targetSection }: SettingsViewProps) => {
	// Track if there are unsaved changes
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
	// State for the unsaved changes dialog
	const [isUnsavedChangesDialogOpen, setIsUnsavedChangesDialogOpen] = useState(false)
	// Store the action to perform after confirmation
	const pendingAction = useRef<() => void>()
	const {
		apiConfiguration,
		version,
		customInstructions,
		setCustomInstructions,
		openRouterModels,
		telemetrySetting,
		setTelemetrySetting,
		chatSettings,
		setChatSettings,
		planActSeparateModelsSetting,
		setPlanActSeparateModelsSetting,
		enableCheckpointsSetting,
		setEnableCheckpointsSetting,
		mcpMarketplaceEnabled,
		setMcpMarketplaceEnabled,
		shellIntegrationTimeout,
		setShellIntegrationTimeout,
		terminalReuseEnabled,
		setTerminalReuseEnabled,
		mcpResponsesCollapsed,
		setMcpResponsesCollapsed,
		setApiConfiguration,
	} = useExtensionState()

	// Store the original state to detect changes
	const originalState = useRef({
		apiConfiguration,
		customInstructions,
		telemetrySetting,
		planActSeparateModelsSetting,
		enableCheckpointsSetting,
		mcpMarketplaceEnabled,
		mcpResponsesCollapsed,
		chatSettings,
		shellIntegrationTimeout,
		terminalReuseEnabled,
	})
	const [apiErrorMessage, setApiErrorMessage] = useState<string | undefined>(undefined)
	const [modelIdErrorMessage, setModelIdErrorMessage] = useState<string | undefined>(undefined)
	const handleSubmit = async (withoutDone: boolean = false) => {
		const apiValidationResult = validateApiConfiguration(apiConfiguration)
		const modelIdValidationResult = validateModelId(apiConfiguration, openRouterModels)

		// setApiErrorMessage(apiValidationResult)
		// setModelIdErrorMessage(modelIdValidationResult)

		let apiConfigurationToSubmit = apiConfiguration
		if (!apiValidationResult && !modelIdValidationResult) {
			// vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
			// vscode.postMessage({
			// 	type: "customInstructions",
			// 	text: customInstructions,
			// })
			// vscode.postMessage({
			// 	type: "telemetrySetting",
			// 	text: telemetrySetting,
			// })
			// console.log("handleSubmit", withoutDone)
			// vscode.postMessage({
			// 	type: "separateModeSetting",
			// 	text: separateModeSetting,
			// })
		} else {
			// if the api configuration is invalid, we don't save it
			apiConfigurationToSubmit = undefined
		}

		try {
			await StateServiceClient.updateSettings(
				UpdateSettingsRequest.create({
					planActSeparateModelsSetting,
					customInstructionsSetting: customInstructions,
					telemetrySetting,
					enableCheckpointsSetting,
					mcpMarketplaceEnabled,
					shellIntegrationTimeout,
					terminalReuseEnabled,
					mcpResponsesCollapsed,
					apiConfiguration: apiConfigurationToSubmit
						? convertApiConfigurationToProtoApiConfiguration(apiConfigurationToSubmit)
						: undefined,
					chatSettings: chatSettings ? convertChatSettingsToProtoChatSettings(chatSettings) : undefined,
				}),
			)
		} catch (error) {
			console.error("Failed to update settings:", error)
		}

		if (!withoutDone) {
			onDone()
		}
	}

	useEffect(() => {
		setApiErrorMessage(undefined)
		setModelIdErrorMessage(undefined)
	}, [apiConfiguration])

	// Check for unsaved changes by comparing current state with original state
	useEffect(() => {
		const hasChanges =
			JSON.stringify(apiConfiguration) !== JSON.stringify(originalState.current.apiConfiguration) ||
			customInstructions !== originalState.current.customInstructions ||
			telemetrySetting !== originalState.current.telemetrySetting ||
			planActSeparateModelsSetting !== originalState.current.planActSeparateModelsSetting ||
			enableCheckpointsSetting !== originalState.current.enableCheckpointsSetting ||
			mcpMarketplaceEnabled !== originalState.current.mcpMarketplaceEnabled ||
			mcpResponsesCollapsed !== originalState.current.mcpResponsesCollapsed ||
			JSON.stringify(chatSettings) !== JSON.stringify(originalState.current.chatSettings) ||
			shellIntegrationTimeout !== originalState.current.shellIntegrationTimeout ||
			terminalReuseEnabled !== originalState.current.terminalReuseEnabled

		setHasUnsavedChanges(hasChanges)
	}, [
		apiConfiguration,
		customInstructions,
		telemetrySetting,
		planActSeparateModelsSetting,
		enableCheckpointsSetting,
		mcpMarketplaceEnabled,
		mcpResponsesCollapsed,
		chatSettings,
		shellIntegrationTimeout,
		terminalReuseEnabled,
	])

	// Handle cancel button click
	const handleCancel = useCallback(() => {
		if (hasUnsavedChanges) {
			// Show confirmation dialog
			setIsUnsavedChangesDialogOpen(true)
			pendingAction.current = () => {
				// Reset all tracked state to original values
				setCustomInstructions(originalState.current.customInstructions)
				setTelemetrySetting(originalState.current.telemetrySetting)
				setPlanActSeparateModelsSetting(originalState.current.planActSeparateModelsSetting)
				setChatSettings(originalState.current.chatSettings)
				if (typeof setApiConfiguration === "function") {
					setApiConfiguration(originalState.current.apiConfiguration ?? {})
				}
				if (typeof setEnableCheckpointsSetting === "function") {
					setEnableCheckpointsSetting(
						typeof originalState.current.enableCheckpointsSetting === "boolean"
							? originalState.current.enableCheckpointsSetting
							: false,
					)
				}
				if (typeof setMcpMarketplaceEnabled === "function") {
					setMcpMarketplaceEnabled(
						typeof originalState.current.mcpMarketplaceEnabled === "boolean"
							? originalState.current.mcpMarketplaceEnabled
							: false,
					)
				}
				// Reset terminal settings
				if (typeof setShellIntegrationTimeout === "function") {
					setShellIntegrationTimeout(originalState.current.shellIntegrationTimeout)
				}
				if (typeof setTerminalReuseEnabled === "function") {
					setTerminalReuseEnabled(originalState.current.terminalReuseEnabled ?? true)
				}
				if (typeof setMcpResponsesCollapsed === "function") {
					setMcpResponsesCollapsed(originalState.current.mcpResponsesCollapsed ?? false)
				}
				// Close settings view
				onDone()
			}
		} else {
			// No changes, just close
			onDone()
		}
	}, [
		hasUnsavedChanges,
		onDone,
		setCustomInstructions,
		setTelemetrySetting,
		setPlanActSeparateModelsSetting,
		setChatSettings,
		setApiConfiguration,
		setEnableCheckpointsSetting,
		setMcpMarketplaceEnabled,
		setMcpResponsesCollapsed,
	])

	// Handle confirmation dialog actions
	const handleConfirmDiscard = useCallback(() => {
		setIsUnsavedChangesDialogOpen(false)
		if (pendingAction.current) {
			pendingAction.current()
			pendingAction.current = undefined
		}
	}, [])

	const handleCancelDiscard = useCallback(() => {
		setIsUnsavedChangesDialogOpen(false)
		pendingAction.current = undefined
	}, [])

	// validate as soon as the component is mounted
	/*
	useEffect will use stale values of variables if they are not included in the dependency array. 
	so trying to use useEffect with a dependency array of only one value for example will use any 
	other variables' old values. In most cases you don't want this, and should opt to use react-use 
	hooks.
    
		// uses someVar and anotherVar
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [someVar])
	If we only want to run code once on mount we can use react-use's useEffectOnce or useMount
	*/

	const handleMessage = useCallback((event: MessageEvent) => {
		const message: ExtensionMessage = event.data
		switch (message.type) {
			// Handle tab navigation through targetSection prop instead
			case "grpc_response":
				if (message.grpc_response?.message?.action === "scrollToSettings") {
					const tabId = message.grpc_response?.message?.value
					if (tabId) {
						console.log("Opening settings tab from GRPC response:", tabId)
						// Check if the value corresponds to a valid tab ID
						const isValidTabId = SETTINGS_TABS.some((tab) => tab.id === tabId)

						if (isValidTabId) {
							// Set the active tab directly
							setActiveTab(tabId)
						} else {
							// Fall back to the old behavior of scrolling to an element
							setTimeout(() => {
								const element = document.getElementById(tabId)
								if (element) {
									element.scrollIntoView({ behavior: "smooth" })

									element.style.transition = "background-color 0.5s ease"
									element.style.backgroundColor = "var(--vscode-textPreformat-background)"

									setTimeout(() => {
										element.style.backgroundColor = "transparent"
									}, 1200)
								}
							}, 300)
						}
					}
				}
				break
		}
	}, [])

	useEvent("message", handleMessage)

	const handleResetState = async () => {
		try {
			await StateServiceClient.resetState(EmptyRequest.create({}))
		} catch (error) {
			console.error("Failed to reset state:", error)
		}
	}

	const handlePlanActModeChange = async (tab: "plan" | "act") => {
		if (tab === chatSettings.mode) {
			return
		}

		// Update settings first to ensure any changes to the current tab are saved
		await handleSubmit(true)

		try {
			await StateServiceClient.togglePlanActMode(
				TogglePlanActModeRequest.create({
					chatSettings: {
						mode: tab === "plan" ? PlanActMode.PLAN : PlanActMode.ACT,
						preferredLanguage: chatSettings.preferredLanguage,
						openAiReasoningEffort: chatSettings.openAIReasoningEffort,
					},
				}),
			)
		} catch (error) {
			console.error("Failed to toggle Plan/Act mode:", error)
		}
	}

	// Track active tab
	const [activeTab, setActiveTab] = useState<string>(targetSection || SETTINGS_TABS[0].id)

	// Update active tab when targetSection changes
	useEffect(() => {
		if (targetSection) {
			setActiveTab(targetSection)
		}
	}, [targetSection])

	// Enhanced tab change handler with debugging
	const handleTabChange = useCallback(
		(tabId: string) => {
			console.log("Tab change requested:", tabId, "Current:", activeTab)
			setActiveTab(tabId)
		},
		[activeTab],
	)

	// Debug tab changes
	useEffect(() => {
		console.log("Active tab changed to:", activeTab)
	}, [activeTab])

	// Track whether we're in compact mode
	const [isCompactMode, setIsCompactMode] = useState(false)
	const containerRef = useRef<HTMLDivElement>(null)

	// Setup resize observer to detect when we should switch to compact mode
	useEffect(() => {
		if (!containerRef.current) return

		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				// If container width is less than 500px, switch to compact mode
				setIsCompactMode(entry.contentRect.width < 500)
			}
		})

		observer.observe(containerRef.current)

		return () => {
			observer?.disconnect()
		}
	}, [])

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center gap-2">
				<div className="flex items-center gap-1">
					<h3 className="text-[var(--vscode-foreground)] m-0">设置</h3>
				</div>
				<div className="flex gap-2">
					<VSCodeButton appearance="secondary" onClick={handleCancel}>
						取消
					</VSCodeButton>
					<VSCodeButton onClick={() => handleSubmit(false)} disabled={!hasUnsavedChanges}>
						保存
					</VSCodeButton>
				</div>
			</TabHeader>

			{/* Vertical tabs layout */}
			<div ref={containerRef} className={cn(settingsTabsContainer, isCompactMode && "narrow")}>
				{/* Tab sidebar */}
				<TabList
					value={activeTab}
					onValueChange={handleTabChange}
					className={cn(settingsTabList)}
					data-compact={isCompactMode}>
					{SETTINGS_TABS.map((tab) =>
						isCompactMode ? (
							<HeroTooltip key={tab.id} content={tab.tooltipText} placement="right">
								<div
									className={cn(
										activeTab === tab.id
											? `${settingsTabTrigger} ${settingsTabTriggerActive}`
											: settingsTabTrigger,
										"focus:ring-0",
									)}
									data-compact={isCompactMode}
									data-testid={`tab-${tab.id}`}
									data-value={tab.id}
									onClick={() => {
										console.log("Compact tab clicked:", tab.id)
										handleTabChange(tab.id)
									}}>
									<div className={cn("flex items-center gap-2", isCompactMode && "justify-center")}>
										<tab.icon className="w-4 h-4" />
										<span className="tab-label">{tab.name}</span>
									</div>
								</div>
							</HeroTooltip>
						) : (
							<TabTrigger
								key={tab.id}
								value={tab.id}
								className={cn(
									activeTab === tab.id
										? `${settingsTabTrigger} ${settingsTabTriggerActive}`
										: settingsTabTrigger,
									"focus:ring-0",
								)}
								data-compact={isCompactMode}
								data-testid={`tab-${tab.id}`}>
								<div className={cn("flex items-center gap-2", isCompactMode && "justify-center")}>
									<tab.icon className="w-4 h-4" />
									<span className="tab-label">{tab.name}</span>
								</div>
							</TabTrigger>
						),
					)}
				</TabList>

				{/* Helper function to render section header */}
				{(() => {
					const renderSectionHeader = (tabId: string) => {
						const tab = SETTINGS_TABS.find((t) => t.id === tabId)
						if (!tab) return null

						return (
							<SectionHeader>
								<div className="flex items-center gap-2">
									{(() => {
										const Icon = tab.icon
										return <Icon className="w-4" />
									})()}
									<div>{tab.headerText}</div>
								</div>
							</SectionHeader>
						)
					}

					return (
						<TabContent className="flex-1 overflow-auto">
							{/* API Configuration Tab */}
							{activeTab === "api-config" && (
								<div>
									{renderSectionHeader("api-config")}
									<Section>
										{/* Tabs container */}
										{planActSeparateModelsSetting ? (
											<div className="rounded-md mb-5 bg-[var(--vscode-panel-background)]">
												<div className="flex gap-[1px] mb-[10px] -mt-2 border-0 border-b border-solid border-[var(--vscode-panel-border)]">
													<TabButton
														isActive={chatSettings.mode === "plan"}
														onClick={() => handlePlanActModeChange("plan")}>
														计划模式
													</TabButton>
													<TabButton
														isActive={chatSettings.mode === "act"}
														onClick={() => handlePlanActModeChange("act")}>
														执行模式
													</TabButton>
												</div>

												{/* Content container */}
												<div className="-mb-3">
													<ApiOptions
														key={chatSettings.mode}
														showModelOptions={true}
														apiErrorMessage={apiErrorMessage}
														modelIdErrorMessage={modelIdErrorMessage}
													/>
												</div>
											</div>
										) : (
											<ApiOptions
												key={"single"}
												showModelOptions={true}
												apiErrorMessage={apiErrorMessage}
												modelIdErrorMessage={modelIdErrorMessage}
											/>
										)}

										<div className="mb-[5px]">
											<VSCodeCheckbox
												className="mb-[5px]"
												checked={planActSeparateModelsSetting}
												onChange={(e: any) => {
													const checked = e.target.checked === true
													setPlanActSeparateModelsSetting(checked)
												}}>
												在计划和执行模式中使用不同的模型
											</VSCodeCheckbox>
											<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
												在计划和行动模式之间切换时，将保留先前模式中使用的API和模型。这可能会很有帮助，例如，当使用强大的推理模型为便宜的编码模型架构计划时，以便进行执行。
											</p>
										</div>

										<div className="mb-[5px]">
											<VSCodeTextArea
												value={customInstructions ?? ""}
												className="w-full"
												resize="vertical"
												rows={4}
												placeholder={
													'例如："在最后运行单元测试", "使用 TypeScript 和 async/await", "说西班牙语"'
												}
												onInput={(e: any) => setCustomInstructions(e.target?.value ?? "")}>
												<span className="font-medium">自定义提示词</span>
											</VSCodeTextArea>
											<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
												这些指令被添加到每个请求发送的系统提示的末尾。
											</p>
										</div>
									</Section>
								</div>
							)}

							{/* General Settings Tab */}
							{activeTab === "general" && (
								<div>
									{renderSectionHeader("general")}
									<Section>
										{chatSettings && (
											<PreferredLanguageSetting
												chatSettings={chatSettings}
												setChatSettings={setChatSettings}
											/>
										)}

										<div className="mb-[5px]">
											<VSCodeCheckbox
												className="mb-[5px]"
												checked={telemetrySetting !== "disabled"}
												onChange={(e: any) => {
													const checked = e.target.checked === true
													setTelemetrySetting(checked ? "enabled" : "disabled")
												}}>
												允许匿名错误和使用报告
											</VSCodeCheckbox>
											<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
												通过发送匿名使用数据和错误报告来帮助改进Cline。没有代码、提示或个人信息会被发送。请参阅我们的{" "}
												<VSCodeLink
													href="https://docs.cline.bot/more-info/telemetry"
													className="text-inherit">
													反馈概述
												</VSCodeLink>{" "}
												和{" "}
												<VSCodeLink href="https://cline.bot/privacy" className="text-inherit">
													隐私政策
												</VSCodeLink>{" "}
												详情.
											</p>
										</div>
									</Section>
								</div>
							)}

							{/* Feature Settings Tab */}
							{activeTab === "features" && (
								<div>
									{renderSectionHeader("features")}
									<Section>
										<FeatureSettingsSection />
									</Section>
								</div>
							)}

							{/* Browser Settings Tab */}
							{activeTab === "browser" && (
								<div>
									{renderSectionHeader("browser")}
									<Section>
										<BrowserSettingsSection />
									</Section>
								</div>
							)}

							{/* Terminal Settings Tab */}
							{activeTab === "terminal" && (
								<div>
									{renderSectionHeader("terminal")}
									<Section>
										<TerminalSettingsSection />
									</Section>
								</div>
							)}

							{/* Debug Tab (only in dev mode) */}
							{IS_DEV && activeTab === "debug" && (
								<div>
									{renderSectionHeader("debug")}
									<Section>
										<VSCodeButton
											onClick={handleResetState}
											className="mt-[5px] w-auto"
											style={{ backgroundColor: "var(--vscode-errorForeground)", color: "black" }}>
											重置
										</VSCodeButton>
										<p className="text-xs mt-[5px] text-[var(--vscode-descriptionForeground)]">
											这将重置扩展中的所有全局状态和秘密存储。
										</p>
									</Section>
								</div>
							)}

							{/* About Tab */}
							{activeTab === "about" && (
								<div>
									{renderSectionHeader("about")}
									<Section>
										<div className="text-center text-[var(--vscode-descriptionForeground)] text-xs leading-[1.2] px-0 py-0 pr-2 pb-[15px] mt-auto">
											<p className="break-words m-0 p-0">
												如果您有任何问题或反馈，请随时在这里提出问题{" "}
												<VSCodeLink
													href="https://github.com/HybridTalentComputing/cline-chinese"
													className="inline">
													https://github.com/HybridTalentComputing/cline-chinese
												</VSCodeLink>
											</p>
											<p className="italic mt-[10px] mb-0 p-0">v{version}</p>
										</div>
									</Section>
								</div>
							)}
						</TabContent>
					)
				})()}
			</div>

			{/* Unsaved Changes Dialog */}
			<UnsavedChangesDialog
				open={isUnsavedChangesDialogOpen}
				onOpenChange={setIsUnsavedChangesDialogOpen}
				onConfirm={handleConfirmDiscard}
				onCancel={handleCancelDiscard}
			/>
		</Tab>
	)
}

export default memo(SettingsView)
