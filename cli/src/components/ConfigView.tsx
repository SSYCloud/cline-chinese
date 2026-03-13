/**
 * 交互式配置视图组件，用于显示和编辑配置值
 * 支持设置、规则、工作流、钩子和技能选项卡
 */

import {
	GlobalStateAndSettings,
	GlobalStateAndSettingsKey,
	LocalState,
	LocalStateKey,
	SETTINGS_DEFAULTS,
} from "@shared/storage/state-keys"
import { Box, Text, useApp, useInput } from "ink"
import React, { useMemo, useState } from "react"
import { useStdinContext } from "../context/StdinContext"
import { fuzzyFilter } from "../utils/fuzzy-search"
import {
	BooleanSelect,
	buildConfigEntries,
	buildToggleEntries,
	ConfigRow,
	HookInfo,
	HookRow,
	MAX_VISIBLE,
	ObjectEditorPanel,
	ObjectEditorState,
	parseValue,
	SEPARATOR,
	SectionHeader,
	SkillInfo,
	SkillRow,
	TABS,
	TabBar,
	TabView,
	TextInput,
	ToggleEntry,
	ToggleRow,
	WorkspaceHooks,
} from "./ConfigViewComponents"

// ============================================================================
// Types
// ============================================================================

interface ConfigViewProps {
	dataDir: string
	globalState: Record<string, unknown>
	workspaceState: Record<string, unknown>
	onUpdateGlobal?: (key: GlobalStateAndSettingsKey, value: GlobalStateAndSettings[GlobalStateAndSettingsKey]) => void
	onUpdateWorkspace?: (key: LocalStateKey, value: LocalState[LocalStateKey]) => void
	// 规则开关
	globalClineRulesToggles?: Record<string, boolean>
	localClineRulesToggles?: Record<string, boolean>
	localCursorRulesToggles?: Record<string, boolean>
	localWindsurfRulesToggles?: Record<string, boolean>
	localAgentsRulesToggles?: Record<string, boolean>
	onToggleRule?: (isGlobal: boolean, rulePath: string, enabled: boolean, ruleType: string) => void
	// 工作流开关
	globalWorkflowToggles?: Record<string, boolean>
	localWorkflowToggles?: Record<string, boolean>
	onToggleWorkflow?: (isGlobal: boolean, workflowPath: string, enabled: boolean) => void
	// 钩子
	hooksEnabled?: boolean
	globalHooks?: HookInfo[]
	workspaceHooks?: WorkspaceHooks[]
	onToggleHook?: (isGlobal: boolean, hookName: string, enabled: boolean, workspaceName?: string) => void
	// 技能
	skillsEnabled?: boolean
	globalSkills?: SkillInfo[]
	localSkills?: SkillInfo[]
	onToggleSkill?: (isGlobal: boolean, skillPath: string, enabled: boolean) => void
	// 打开文件夹回调
	onOpenFolder?: (folderType: "rules" | "workflows" | "hooks" | "skills", isGlobal: boolean) => void
}

// ============================================================================
// Main Component
// ============================================================================

export const ConfigView: React.FC<ConfigViewProps> = ({
	dataDir,
	globalState,
	workspaceState,
	onUpdateGlobal,
	onUpdateWorkspace,
	globalClineRulesToggles,
	localClineRulesToggles,
	localCursorRulesToggles,
	localWindsurfRulesToggles,
	localAgentsRulesToggles,
	onToggleRule,
	globalWorkflowToggles,
	localWorkflowToggles,
	onToggleWorkflow,
	hooksEnabled,
	globalHooks = [],
	workspaceHooks = [],
	onToggleHook,
	skillsEnabled,
	globalSkills = [],
	localSkills = [],
	onToggleSkill,
	onOpenFolder,
}) => {
	const { exit } = useApp()
	const { isRawModeSupported } = useStdinContext()
	const [currentTab, setCurrentTab] = useState<TabView>("settings")
	const [isEditing, setIsEditing] = useState(false)
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [editValue, setEditValue] = useState("")
	const [searchQuery, setSearchQuery] = useState("")
	const [objectEditor, setObjectEditor] = useState<ObjectEditorState | null>(null)

	// 构建设置选项卡的条目
	const configEntries = useMemo(
		() => [...buildConfigEntries(globalState, "global"), ...buildConfigEntries(workspaceState, "workspace")],
		[globalState, workspaceState],
	)

	const filteredConfigEntries = useMemo(() => {
		if (!searchQuery.trim()) {
			return configEntries
		}
		return fuzzyFilter(configEntries, searchQuery, (entry) => `${entry.key} ${String(entry.value ?? "")}`)
	}, [configEntries, searchQuery])

	// 构建规则选项卡的条目
	const ruleEntries = useMemo(() => {
		const entries: ToggleEntry[] = []
		entries.push(...buildToggleEntries(globalClineRulesToggles, "global", "cline"))
		entries.push(...buildToggleEntries(localClineRulesToggles, "workspace", "cline"))
		entries.push(...buildToggleEntries(localCursorRulesToggles, "workspace", "cursor"))
		entries.push(...buildToggleEntries(localWindsurfRulesToggles, "workspace", "windsurf"))
		entries.push(...buildToggleEntries(localAgentsRulesToggles, "workspace", "agents"))
		return entries
	}, [
		globalClineRulesToggles,
		localClineRulesToggles,
		localCursorRulesToggles,
		localWindsurfRulesToggles,
		localAgentsRulesToggles,
	])

	// 构建工作流选项卡的条目
	const workflowEntries = useMemo(() => {
		const entries: ToggleEntry[] = []
		entries.push(...buildToggleEntries(globalWorkflowToggles, "global"))
		entries.push(...buildToggleEntries(localWorkflowToggles, "workspace"))
		return entries
	}, [globalWorkflowToggles, localWorkflowToggles])

	// 构建钩子的扁平列表
	const hookEntries = useMemo(() => {
		const entries: { hook: HookInfo; isGlobal: boolean; workspaceName?: string }[] = []
		globalHooks.forEach((hook) => entries.push({ hook, isGlobal: true }))
		workspaceHooks.forEach((ws) => {
			ws.hooks.forEach((hook) => entries.push({ hook, isGlobal: false, workspaceName: ws.workspaceName }))
		})
		return entries.sort((a, b) => a.hook.name.localeCompare(b.hook.name))
	}, [globalHooks, workspaceHooks])

	// 构建技能的扁平列表
	const skillEntries = useMemo(() => {
		const entries: { skill: SkillInfo; isGlobal: boolean }[] = []
		globalSkills.forEach((skill) => entries.push({ skill, isGlobal: true }))
		localSkills.forEach((skill) => entries.push({ skill, isGlobal: false }))
		return entries.sort((a, b) => a.skill.name.localeCompare(b.skill.name))
	}, [globalSkills, localSkills])

	// 根据选项卡获取当前列表长度
	const currentListLength = useMemo(() => {
		switch (currentTab) {
			case "settings":
				return filteredConfigEntries.length
			case "rules":
				return ruleEntries.length
			case "workflows":
				return workflowEntries.length
			case "hooks":
				return hookEntries.length
			case "skills":
				return skillEntries.length
			default:
				return 0
		}
	}, [
		currentTab,
		filteredConfigEntries.length,
		ruleEntries.length,
		workflowEntries.length,
		hookEntries.length,
		skillEntries.length,
	])

	// 获取可用选项卡
	const availableTabs = useMemo(() => {
		return TABS.filter((tab) => {
			if (tab.requiresFlag === "hooks") {
				return hooksEnabled
			}
			if (tab.requiresFlag === "skills") {
				return skillsEnabled
			}
			return true
		})
	}, [hooksEnabled, skillsEnabled])

	// 切换选项卡时重置选择
	const handleTabChange = (newTab: TabView) => {
		setCurrentTab(newTab)
		setSelectedIndex(0)
		setIsEditing(false)
		setObjectEditor(null)
	}

	// 设置选项卡处理函数
	const selectedConfigEntry = filteredConfigEntries[selectedIndex]

	const handleSettingsSave = (value: string | boolean) => {
		if (!selectedConfigEntry) {
			return
		}
		const parsed = typeof value === "boolean" ? value : parseValue(value, selectedConfigEntry.type)

		if (selectedConfigEntry.source === "global" && onUpdateGlobal) {
			onUpdateGlobal(selectedConfigEntry.key as GlobalStateAndSettingsKey, parsed as never)
		} else if (selectedConfigEntry.source === "workspace" && onUpdateWorkspace) {
			onUpdateWorkspace(selectedConfigEntry.key as LocalStateKey, parsed as never)
		}
		setIsEditing(false)
	}

	const getObjectAtPath = (root: Record<string, unknown>, path: string[]): Record<string, unknown> => {
		let current: unknown = root
		for (const segment of path) {
			if (!current || typeof current !== "object") {
				return {}
			}
			current = (current as Record<string, unknown>)[segment]
		}
		return current && typeof current === "object" ? (current as Record<string, unknown>) : {}
	}

	const setObjectValueAtPath = (
		root: Record<string, unknown>,
		path: string[],
		key: string,
		value: unknown,
	): Record<string, unknown> => {
		if (path.length === 0) {
			return { ...root, [key]: value }
		}
		const [head, ...rest] = path
		const child = root[head]
		const childObj = child && typeof child === "object" ? (child as Record<string, unknown>) : {}
		return {
			...root,
			[head]: setObjectValueAtPath(childObj, rest, key, value),
		}
	}

	const persistObjectEditor = (nextObject: Record<string, unknown>, source: "global" | "workspace", key: string) => {
		if (source === "global" && onUpdateGlobal) {
			onUpdateGlobal(key as GlobalStateAndSettingsKey, nextObject as never)
		} else if (source === "workspace" && onUpdateWorkspace) {
			onUpdateWorkspace(key as LocalStateKey, nextObject as never)
		}
	}

	const handleSettingsReset = () => {
		if (!selectedConfigEntry?.isEditable || selectedConfigEntry.source !== "global") {
			return
		}
		const defaultValue = (SETTINGS_DEFAULTS as Record<string, unknown>)[selectedConfigEntry.key]
		if (defaultValue !== undefined && onUpdateGlobal) {
			onUpdateGlobal(selectedConfigEntry.key as GlobalStateAndSettingsKey, defaultValue as never)
		}
	}

	// 规则/工作流/钩子/技能切换处理函数
	const handleToggle = () => {
		if (currentTab === "rules" && ruleEntries[selectedIndex] && onToggleRule) {
			const entry = ruleEntries[selectedIndex]
			onToggleRule(entry.source === "global", entry.path, !entry.enabled, entry.ruleType || "cline")
		} else if (currentTab === "workflows" && workflowEntries[selectedIndex] && onToggleWorkflow) {
			const entry = workflowEntries[selectedIndex]
			onToggleWorkflow(entry.source === "global", entry.path, !entry.enabled)
		} else if (currentTab === "hooks" && hookEntries[selectedIndex] && onToggleHook) {
			const entry = hookEntries[selectedIndex]
			onToggleHook(entry.isGlobal, entry.hook.name, !entry.hook.enabled, entry.workspaceName)
		} else if (currentTab === "skills" && skillEntries[selectedIndex] && onToggleSkill) {
			const entry = skillEntries[selectedIndex]
			onToggleSkill(entry.isGlobal, entry.skill.path, !entry.skill.enabled)
		}
	}

	// 输入处理
	useInput(
		(input, key) => {
			if (objectEditor) {
				return
			}

			if (key.escape) {
				exit()
			}

			if (key.leftArrow || key.rightArrow || (input >= "1" && input <= "5")) {
				const currentTabIndex = availableTabs.findIndex((t) => t.key === currentTab)
				const targetIdx =
					input >= "1" && input <= "5"
						? Number.parseInt(input) - 1
						: key.leftArrow
							? (currentTabIndex - 1 + availableTabs.length) % availableTabs.length
							: (currentTabIndex + 1) % availableTabs.length
				if (targetIdx >= 0 && targetIdx < availableTabs.length) {
					handleTabChange(availableTabs[targetIdx].key)
				}
				return
			}

			// 列表导航（箭头键和vim风格的j/k）
			if (key.upArrow) {
				setSelectedIndex((i) => (i > 0 ? i - 1 : currentListLength - 1))
			} else if (key.downArrow) {
				setSelectedIndex((i) => (i < currentListLength - 1 ? i + 1 : 0))
			}

			// 选项卡特定操作
			if (currentTab === "settings") {
				if ((key.return || key.tab) && selectedConfigEntry?.isEditable) {
					if (selectedConfigEntry.type === "boolean") {
						handleSettingsSave(!selectedConfigEntry.value)
						return
					}
					if (selectedConfigEntry.type === "object") {
						const value =
							selectedConfigEntry.value && typeof selectedConfigEntry.value === "object"
								? (selectedConfigEntry.value as Record<string, unknown>)
								: {}
						setObjectEditor({
							source: selectedConfigEntry.source,
							key: selectedConfigEntry.key,
							path: [],
							value,
							selectedIndex: 0,
							isEditingValue: false,
							editValue: "",
						})
						return
					}
					setEditValue(selectedConfigEntry.value !== undefined ? String(selectedConfigEntry.value) : "")
					setIsEditing(true)
				} else if (key.ctrl && input.toLowerCase() === "r") {
					handleSettingsReset()
				} else if (key.backspace || key.delete) {
					setSearchQuery((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta && !key.escape && !key.upArrow && !key.downArrow) {
					setSearchQuery((prev) => prev + input)
				}
			} else if (key.return || key.tab || input === " ") {
				// 切换规则/工作流/钩子/技能
				handleToggle()
			}

			// 打开文件夹（用于规则/工作流/钩子/技能选项卡）
			if (input === "o" && onOpenFolder && currentTab !== "settings") {
				// 根据所选条目确定当前选择是全局还是工作区
				let isGlobal = true
				if (currentTab === "rules" && ruleEntries[selectedIndex]) {
					isGlobal = ruleEntries[selectedIndex].source === "global"
				} else if (currentTab === "workflows" && workflowEntries[selectedIndex]) {
					isGlobal = workflowEntries[selectedIndex].source === "global"
				} else if (currentTab === "hooks" && hookEntries[selectedIndex]) {
					isGlobal = hookEntries[selectedIndex].isGlobal
				} else if (currentTab === "skills" && skillEntries[selectedIndex]) {
					isGlobal = skillEntries[selectedIndex].isGlobal
				}
				onOpenFolder(currentTab as "rules" | "workflows" | "hooks" | "skills", isGlobal)
			}
		},
		{ isActive: isRawModeSupported && !isEditing },
	)

	// 滚动窗口
	const halfVisible = Math.floor(MAX_VISIBLE / 2)
	const startIndex = Math.max(0, Math.min(selectedIndex - halfVisible, currentListLength - MAX_VISIBLE))

	// 编辑模式UI（仅设置）
	if (isEditing && selectedConfigEntry && currentTab === "settings") {
		const header = (
			<React.Fragment>
				<Text bold color="white">
					⚙️ 编辑配置
				</Text>
				<Text color="gray">{SEPARATOR}</Text>
			</React.Fragment>
		)

		if (selectedConfigEntry.type === "boolean") {
			return (
				<Box flexDirection="column">
					{header}
					<BooleanSelect
						label={selectedConfigEntry.key}
						onCancel={() => setIsEditing(false)}
						onSelect={handleSettingsSave}
						value={Boolean(selectedConfigEntry.value)}
					/>
				</Box>
			)
		}

		return (
			<Box flexDirection="column">
				{header}
				<TextInput
					label={selectedConfigEntry.key}
					onCancel={() => setIsEditing(false)}
					onChange={setEditValue}
					onSubmit={handleSettingsSave}
					type={selectedConfigEntry.type}
					value={editValue}
				/>
			</Box>
		)
	}

	if (objectEditor && currentTab === "settings") {
		return (
			<ObjectEditorPanel
				getObjectAtPath={getObjectAtPath}
				onClose={() => setObjectEditor(null)}
				onPersist={(nextObject) => persistObjectEditor(nextObject, objectEditor.source, objectEditor.key)}
				setObjectValueAtPath={setObjectValueAtPath}
				setState={setObjectEditor}
				state={objectEditor}
			/>
		)
	}

	// 渲染选项卡内容
	const renderTabContent = () => {
		switch (currentTab) {
			case "settings": {
				const visibleEntries = filteredConfigEntries.slice(startIndex, startIndex + MAX_VISIBLE)
				return (
					<React.Fragment>
						<Box>
							<Text>搜索：</Text>
							<Text color="white">{searchQuery}</Text>
							<Text inverse> </Text>
						</Box>
						<Box>
							<Text>数据目录：</Text>
							<Text color="blue" underline>
								{dataDir}
							</Text>
						</Box>
						<Text color="gray">{SEPARATOR}</Text>
						<Box flexDirection="column">
							{visibleEntries.map((entry, idx) => {
								const actualIndex = startIndex + idx
								const prevEntry = visibleEntries[idx - 1]
								const showHeader = !prevEntry || prevEntry.source !== entry.source

								return (
									<React.Fragment key={`${entry.source}-${entry.key}`}>
										{showHeader && (
											<SectionHeader title={entry.source === "global" ? "全局设置：" : "工作区设置："} />
										)}
										<ConfigRow entry={entry} isSelected={actualIndex === selectedIndex} />
									</React.Fragment>
								)
							})}
						</Box>
					</React.Fragment>
				)
			}

			case "rules": {
				if (ruleEntries.length === 0) {
					return (
						<Box>
							<Text color="gray">未配置规则。请添加 .clinerules 文件到工作区或全局配置。</Text>
						</Box>
					)
				}
				const visibleEntries = ruleEntries.slice(startIndex, startIndex + MAX_VISIBLE)
				return (
					<Box flexDirection="column">
						{visibleEntries.map((entry, idx) => {
							const actualIndex = startIndex + idx
							const prevEntry = visibleEntries[idx - 1]
							const showHeader = !prevEntry || prevEntry.source !== entry.source

							return (
								<React.Fragment key={`${entry.source}-${entry.path}`}>
									{showHeader && (
										<SectionHeader title={entry.source === "global" ? "全局规则：" : "工作区规则："} />
									)}
									<ToggleRow entry={entry} isSelected={actualIndex === selectedIndex} showType />
								</React.Fragment>
							)
						})}
					</Box>
				)
			}

			case "workflows": {
				if (workflowEntries.length === 0) {
					return (
						<Box>
							<Text color="gray">未配置工作流。请添加工作流文件以启用此功能。</Text>
						</Box>
					)
				}
				const visibleEntries = workflowEntries.slice(startIndex, startIndex + MAX_VISIBLE)
				return (
					<Box flexDirection="column">
						{visibleEntries.map((entry, idx) => {
							const actualIndex = startIndex + idx
							const prevEntry = visibleEntries[idx - 1]
							const showHeader = !prevEntry || prevEntry.source !== entry.source

							return (
								<React.Fragment key={`${entry.source}-${entry.path}`}>
									{showHeader && (
										<SectionHeader title={entry.source === "global" ? "全局工作流：" : "工作区工作流："} />
									)}
									<ToggleRow entry={entry} isSelected={actualIndex === selectedIndex} />
								</React.Fragment>
							)
						})}
					</Box>
				)
			}

			case "hooks": {
				if (hookEntries.length === 0) {
					return (
						<Box>
							<Text color="gray">未配置钩子。请添加钩子脚本以启用自动化。</Text>
						</Box>
					)
				}
				const visibleEntries = hookEntries.slice(startIndex, startIndex + MAX_VISIBLE)
				return (
					<Box flexDirection="column">
						{visibleEntries.map((entry, idx) => {
							const actualIndex = startIndex + idx
							const prevEntry = visibleEntries[idx - 1]
							const showHeader =
								!prevEntry ||
								prevEntry.isGlobal !== entry.isGlobal ||
								prevEntry.workspaceName !== entry.workspaceName

							let sectionTitle = "全局钩子："
							if (!entry.isGlobal && entry.workspaceName) {
								sectionTitle = `${entry.workspaceName} 钩子：`
							}

							return (
								<React.Fragment key={`${entry.isGlobal}-${entry.workspaceName || ""}-${entry.hook.name}`}>
									{showHeader && <SectionHeader title={sectionTitle} />}
									<HookRow hook={entry.hook} isSelected={actualIndex === selectedIndex} />
								</React.Fragment>
							)
						})}
					</Box>
				)
			}

			case "skills": {
				if (skillEntries.length === 0) {
					return (
						<Box>
							<Text color="gray">未配置技能。请添加 SKILL.md 文件以启用技能。</Text>
						</Box>
					)
				}
				const visibleEntries = skillEntries.slice(startIndex, startIndex + MAX_VISIBLE)
				return (
					<Box flexDirection="column">
						{visibleEntries.map((entry, idx) => {
							const actualIndex = startIndex + idx
							const prevEntry = visibleEntries[idx - 1]
							const showHeader = !prevEntry || prevEntry.isGlobal !== entry.isGlobal

							return (
								<React.Fragment key={`${entry.isGlobal}-${entry.skill.path}`}>
									{showHeader && <SectionHeader title={entry.isGlobal ? "全局技能：" : "工作区技能："} />}
									<SkillRow isSelected={actualIndex === selectedIndex} skill={entry.skill} />
								</React.Fragment>
							)
						})}
					</Box>
				)
			}

			default:
				return null
		}
	}

	// 根据当前选项卡获取帮助文本
	const getHelpText = () => {
		const base = "↑/↓ 导航 • ←/→ 切换标签 • 1-5 切换标签 • Esc 退出"
		if (currentTab === "settings") {
			return `${base} • 输入搜索 • 回车/Tab 编辑（布尔值切换）• 退格清除搜索 • Ctrl+R 重置`
		}
		const openFolder = onOpenFolder ? " • o 打开文件夹" : ""
		return `${base} • 回车/Tab/空格 切换${openFolder}`
	}

	return (
		<Box flexDirection="column">
			<Text bold color="white">
				⚙️ Cline 配置
			</Text>
			<Text color="gray">{SEPARATOR}</Text>

			<TabBar currentTab={currentTab} hooksEnabled={hooksEnabled} skillsEnabled={skillsEnabled} tabs={TABS} />

			<Text color="gray">{SEPARATOR}</Text>

			{renderTabContent()}

			{currentListLength > MAX_VISIBLE && (
				<Box marginTop={1}>
					<Text color="gray">
						{startIndex > 0 ? "↑ " : "  "}
						显示 {startIndex + 1}-{Math.min(startIndex + MAX_VISIBLE, currentListLength)} / {currentListLength}
						{startIndex + MAX_VISIBLE < currentListLength ? " ↓" : "  "}
					</Text>
				</Box>
			)}

			<Text color="gray">{SEPARATOR}</Text>

			<Box flexDirection="column">
				<Text color="gray">{getHelpText()}</Text>
				{currentTab === "settings" && selectedConfigEntry && !selectedConfigEntry.isEditable && (
					<Text color="yellow">此字段为只读（{selectedConfigEntry.type} 类型或不是设置项）</Text>
				)}
			</Box>
		</Box>
	)
}
