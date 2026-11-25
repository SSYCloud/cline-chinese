export interface SlashCommand {
	name: string
	description?: string
	section?: "default" | "custom" | "mcp" | "skill" | "mcpServer"
	cliCompatible?: boolean
	provider?: string
}

export const SKILL_COMMAND_PREFIX = "skill:"
export const MCP_SERVER_COMMAND_PREFIX = "mcp:"

const SLASH_SAFE_NAME_REGEX = /^[a-zA-Z0-9_.@-]+$/

/**
 * Names that can be typed after a slash and still match the chat input's
 * command token regex. Names with spaces or colons cannot be invoked by typing,
 * so their commands are not offered.
 */
export function isSlashSafeName(name: string): boolean {
	return SLASH_SAFE_NAME_REGEX.test(name)
}

export const BASE_SLASH_COMMANDS: SlashCommand[] = [
	// `/newtask` is an alias of `/compact`: condensing achieves its goal
	// (continue working with a fresh, summarized context window) without the
	// legacy new_task tool. The webview intercepts all three spellings and
	// runs the condense RPC (see useMessageHandlers.handleSendMessage).
	{
		name: "newtask",
		description: "Condenses the current task and continues with a fresh context window",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "deep-planning",
		description: "Create a comprehensive implementation plan before coding",
		section: "default",
		cliCompatible: true,
	},
	// NOTE: legacy's /newrule and /reportbug are hidden until their prompt
	// expansions are ported to the SDK runtime — without expansion the literal
	// command text reaches the model, which silently degrades to plain chat.
	{
		name: "compact",
		description: "Condenses your current context window",
		section: "default",
		cliCompatible: true,
	},
	{
		name: "smol",
		description: "Alias for /compact",
		section: "default",
		cliCompatible: true,
	},
]

// VS Code-only slash commands
export type MarketplaceInstallType = "skill" | "mcp" | "plugin"

export const MARKETPLACE_INSTALL_COMMANDS: Record<string, MarketplaceInstallType> = {
	"/skill:install": "skill",
	"/mcp:install": "mcp",
	"/plugin:install": "plugin",
}

export const VSCODE_ONLY_COMMANDS: SlashCommand[] = [
	{
		name: "skill:install",
		description: "打开自定义页面，安装技能",
		section: "default",
	},
	{
		name: "mcp:install",
		description: "打开自定义页面，安装 MCP 服务器",
		section: "default",
	},
	{
		name: "plugin:install",
		description: "打开自定义页面，安装插件",
		section: "default",
	},
]

export const SHENGSUANYUN_PROVIDER_ID = "shengsuanyun"

export const PROVIDER_SLASH_COMMANDS: SlashCommand[] = []

export function providerSlashCommands(provider: string | undefined): SlashCommand[] {
	return PROVIDER_SLASH_COMMANDS.filter((cmd) => cmd.provider === provider)
}
