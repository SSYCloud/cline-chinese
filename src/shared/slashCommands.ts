export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom" | "mcp"
	cliCompatible?: boolean
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
	{
		name: "newtask",
		description: "根据当前任务的上下文创建一个新任务",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "deep-planning",
		description: "在编写代码之前，制定一份全面的实施计划。",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "smol",
		description: "缩小当前上下文窗口",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "newrule",
		description: "根据您的对话创建新的 Cline 规则",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "reportbug",
		description: "创建一个 Github issue",
		section: "default",
		cliCompatible: true,
	},
]

// VS Code-only slash commands
export const VSCODE_ONLY_COMMANDS: SlashCommand[] = [
	{
		name: "explain-changes",
		description: "解释 Git 引用（PR、提交、分支等）之间的代码变更。",
		section: "default",
	},
]

// CLI-only slash commands (handled locally, not sent to backend)
export const CLI_ONLY_COMMANDS: SlashCommand[] = [
	{
		name: "help",
		description: "怎么使用 Cline CLI",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "settings",
		description: "改变 API 供应商, 自动批准, 功能设置",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "models",
		description: "更改当前模式使用的模型",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "history",
		description: "浏览和搜索任务历史记录",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "clear",
		description: "清除当前任务并重新开始。",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "exit",
		description: "Ctrl+C 的替代方案",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "q",
		description: "Ctrl+C 的替代方案",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "skills",
		description: "查看和管理已安装的技能",
		section: "default",
		cliCompatible: true,
	},
]
