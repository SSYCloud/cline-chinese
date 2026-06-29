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
export const VSCODE_ONLY_COMMANDS: SlashCommand[] = []
