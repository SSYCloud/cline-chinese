import { UpdateSettingsRequest } from "@shared/proto/cline/state"
import { memo, type ReactNode, useCallback } from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import Section from "../Section"
import SettingsSlider from "../SettingsSlider"
import { updateSetting } from "../utils/settingsHandlers"

// Reusable checkbox component for feature settings
interface FeatureCheckboxProps {
	checked: boolean | undefined
	onChange: (checked: boolean) => void
	label: string
	description: ReactNode
	disabled?: boolean
	isRemoteLocked?: boolean
	remoteTooltip?: string
	isVisible?: boolean
}

// Interface for feature toggle configuration
interface FeatureToggle {
	id: string
	label: string
	description: ReactNode
	settingKey: keyof UpdateSettingsRequest
	stateKey: string
	/** If set, the setting value is nested with this key (e.g., "enabled" -> { enabled: checked }) */
	nestedKey?: string
}

const agentFeatures: FeatureToggle[] = [
	{
		id: "subagents",
		label: "子 agents",
		description: "让 Cline 并行运行专注的子代理来为你探索代码库。",
		stateKey: "subagentsEnabled",
		settingKey: "subagentsEnabled",
	},
	{
		id: "native-tool-call",
		label: "本地工具调用",
		description: "尽可能使用原生函数调用",
		stateKey: "nativeToolCallSetting",
		settingKey: "nativeToolCallEnabled",
	},
	{
		id: "parallel-tool-calling",
		label: "并行工具调用",
		description: "同时执行多个工具调用",
		stateKey: "enableParallelToolCalling",
		settingKey: "enableParallelToolCalling",
	},
	{
		id: "strict-plan-mode",
		label: "严格计划模式",
		description: "计划模式下禁止编辑文件",
		stateKey: "strictPlanModeEnabled",
		settingKey: "strictPlanModeEnabled",
	},
	{
		id: "auto-compact",
		label: "自动简化",
		description: "自动压缩对话记录。",
		stateKey: "useAutoCondense",
		settingKey: "useAutoCondense",
	},
	{
		id: "focus-chain",
		label: "焦点链",
		description: "在互动过程中始终关注上下文",
		stateKey: "focusChainEnabled",
		settingKey: "focusChainSettings",
		nestedKey: "enabled",
	},
]

const editorFeatures: FeatureToggle[] = [
	{
		id: "background-edit",
		label: "背景编辑",
		description: "允许编辑而不占用编辑器焦点",
		stateKey: "backgroundEditEnabled",
		settingKey: "backgroundEditEnabled",
	},
	{
		id: "checkpoints",
		label: "检查点",
		description: "在关键节点保存进度以便轻松回滚",
		stateKey: "enableCheckpointsSetting",
		settingKey: "enableCheckpointsSetting",
	},
	{
		id: "cline-web-tools",
		label: "Cline 网页工具",
		description: "访问网页浏览和搜索功能",
		stateKey: "clineWebToolsEnabled",
		settingKey: "clineWebToolsEnabled",
	},
	{
		id: "worktrees",
		label: "工作树",
		description: "启用 git 工作树管理，以便并行运行 Cline 任务。",
		stateKey: "worktreesEnabled",
		settingKey: "worktreesEnabled",
	},
]

const experimentalFeatures: FeatureToggle[] = [
	{
		id: "yolo",
		label: "Yolo 模式",
		description: "无需用户确认即可执行任务。自动从计划模式切换到行动模式，并禁用询问工具。请极其谨慎地使用。",
		stateKey: "yoloModeToggled",
		settingKey: "yoloModeToggled",
	},
	{
		id: "double-check-completion",
		label: "再次核对完成情况",
		description: "拒绝第一次完成尝试，并要求模型在接受之前根据原始任务要求重新验证其工作。",
		stateKey: "doubleCheckCompletionEnabled",
		settingKey: "doubleCheckCompletionEnabled",
	},
]

const FeatureRow = memo(
	({
		checked = false,
		onChange,
		label,
		description,
		disabled,
		isRemoteLocked,
		isVisible = true,
		remoteTooltip,
	}: FeatureCheckboxProps) => {
		if (!isVisible) {
			return null
		}

		const checkbox = (
			<div className="flex items-center justify-between w-full">
				<div>{label}</div>
				<div>
					<Switch
						checked={checked}
						className="shrink-0"
						disabled={disabled || isRemoteLocked}
						id={label}
						onCheckedChange={onChange}
						size="lg"
					/>
					{isRemoteLocked && <i className="codicon codicon-lock text-description text-sm" />}
				</div>
			</div>
		)

		return (
			<div className="flex flex-col items-start justify-between gap-4 py-3 w-full">
				<div className="space-y-0.5 flex-1 w-full">
					{isRemoteLocked ? (
						<Tooltip>
							<TooltipTrigger asChild>{checkbox}</TooltipTrigger>
							<TooltipContent className="max-w-xs" side="top">
								{remoteTooltip}
							</TooltipContent>
						</Tooltip>
					) : (
						checkbox
					)}
				</div>
				<div className="text-xs text-description">{description}</div>
			</div>
		)
	},
)

interface FeatureSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const FeatureSettingsSection = ({ renderSectionHeader }: FeatureSettingsSectionProps) => {
	const {
		enableCheckpointsSetting,
		mcpDisplayMode,
		strictPlanModeEnabled,
		yoloModeToggled,
		useAutoCondense,
		subagentsEnabled,
		clineWebToolsEnabled,
		worktreesEnabled,
		focusChainSettings,
		remoteConfigSettings,
		nativeToolCallSetting,
		enableParallelToolCalling,
		backgroundEditEnabled,
		doubleCheckCompletionEnabled,
	} = useExtensionState()

	const handleFocusChainIntervalChange = useCallback(
		(value: number) => {
			updateSetting("focusChainSettings", { ...focusChainSettings, remindClineInterval: value })
		},
		[focusChainSettings],
	)

	const isYoloRemoteLocked = remoteConfigSettings?.yoloModeToggled !== undefined

	// State lookup for mapped features
	const featureState: Record<string, boolean | undefined> = {
		enableCheckpointsSetting,
		strictPlanModeEnabled,
		nativeToolCallSetting,
		focusChainEnabled: focusChainSettings?.enabled,
		useAutoCondense,
		subagentsEnabled,
		clineWebToolsEnabled: clineWebToolsEnabled?.user,
		worktreesEnabled: worktreesEnabled?.user,
		enableParallelToolCalling,
		backgroundEditEnabled,
		doubleCheckCompletionEnabled,
		yoloModeToggled: isYoloRemoteLocked ? remoteConfigSettings?.yoloModeToggled : yoloModeToggled,
	}

	// Visibility lookup for features with feature flags
	const featureVisibility: Record<string, boolean | undefined> = {
		clineWebToolsEnabled: clineWebToolsEnabled?.featureFlag,
		worktreesEnabled: worktreesEnabled?.featureFlag,
	}

	// Handler for feature toggle changes, supports nested settings like focusChainSettings
	const handleFeatureChange = useCallback(
		(feature: FeatureToggle, checked: boolean) => {
			if (feature.nestedKey) {
				// For nested settings, spread the existing value and set the nested key
				let currentValue = {}
				if (feature.settingKey === "focusChainSettings") {
					currentValue = focusChainSettings ?? {}
				}
				updateSetting(feature.settingKey, { ...currentValue, [feature.nestedKey]: checked })
			} else {
				updateSetting(feature.settingKey, checked)
			}
		},
		[focusChainSettings],
	)

	return (
		<div className="mb-2">
			{renderSectionHeader("features")}
			<Section>
				<div className="mb-5 flex flex-col gap-3">
					{/* Core features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">Agent</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="agent-features">
							{agentFeatures.map((feature) => (
								<div key={feature.id}>
									<FeatureRow
										checked={featureState[feature.stateKey]}
										description={feature.description}
										isVisible={featureVisibility[feature.stateKey] ?? true}
										key={feature.id}
										label={feature.label}
										onChange={(checked) =>
											feature.nestedKey === "enabled"
												? handleFeatureChange(feature, checked)
												: updateSetting(feature.settingKey, checked)
										}
									/>
									{feature.id === "focus-chain" && featureState[feature.stateKey] && (
										<SettingsSlider
											label="Reminder Interval (1-10)"
											max={10}
											min={1}
											onChange={handleFocusChainIntervalChange}
											step={1}
											value={focusChainSettings?.remindClineInterval || 6}
											valueWidth="w-6"
										/>
									)}
								</div>
							))}
						</div>
					</div>

					{/* Editor features */}
					<div>
						<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">编辑器</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50"
							id="optional-features">
							{editorFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => handleFeatureChange(feature, checked)}
								/>
							))}
						</div>
					</div>

					{/* Experimental features */}
					{/* <div>
						<div className="text-xs font-medium uppercase tracking-wider mb-3 text-warning/80">Experimental</div>
						<div
							className="relative p-3 pt-0 my-3 rounded-md border border-editor-widget-border/50 w-full"
							id="experimental-features">
							{experimentalFeatures.map((feature) => (
								<FeatureRow
									checked={featureState[feature.stateKey]}
									description={feature.description}
									disabled={feature.id === "yolo" && isYoloRemoteLocked}
									isRemoteLocked={feature.id === "yolo" && isYoloRemoteLocked}
									isVisible={featureVisibility[feature.stateKey] ?? true}
									key={feature.id}
									label={feature.label}
									onChange={(checked) => handleFeatureChange(feature, checked)}
									remoteTooltip="This setting is managed by your organization's remote configuration"
								/>
							))}
						</div>
					</div> */}
				</div>

				{/* Advanced */}
				<div>
					<div className="text-xs font-medium text-foreground/80 uppercase tracking-wider mb-3">高级</div>
					<div className="relative p-3 my-3 rounded-md border border-editor-widget-border/50" id="advanced-features">
						<div className="space-y-3">
							{/* MCP Display Mode */}
							<div className="space-y-2">
								<Label className="text-sm font-medium text-foreground">MCP 显示模式</Label>
								<p className="text-xs text-muted-foreground">MCP 回复控制</p>
								<Select onValueChange={(v) => updateSetting("mcpDisplayMode", v)} value={mcpDisplayMode}>
									<SelectTrigger className="w-full">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="plain">纯文本</SelectItem>
										<SelectItem value="rich">富文本</SelectItem>
										<SelectItem value="markdown">Markdown</SelectItem>
									</SelectContent>
								</Select>
							</div>
						</div>
					</div>
				</div>
			</Section>
		</div>
	)
}
export default memo(FeatureSettingsSection)
