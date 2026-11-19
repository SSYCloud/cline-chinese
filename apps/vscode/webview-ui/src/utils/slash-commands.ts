import type { McpServer } from "@shared/mcp"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import {
	BASE_SLASH_COMMANDS,
	isSlashSafeName,
	MCP_SERVER_COMMAND_PREFIX,
	providerSlashCommands,
	SKILL_COMMAND_PREFIX,
	type SlashCommand,
	VSCODE_ONLY_COMMANDS,
} from "../../../src/shared/slashCommands.ts"

export type { SlashCommand }

export interface SkillCommandSource {
	name: string
	description?: string
	enabled: boolean
}

const DEFAULT_SLASH_COMMANDS: SlashCommand[] =
	PLATFORM_CONFIG.type === PlatformType.VSCODE ? [...BASE_SLASH_COMMANDS, ...VSCODE_ONLY_COMMANDS] : BASE_SLASH_COMMANDS

function getWorkflowCommands(
	localWorkflowToggles: Record<string, boolean>,
	globalWorkflowToggles: Record<string, boolean>,
	remoteWorkflowToggles?: Record<string, boolean>,
	remoteWorkflows?: any[],
): SlashCommand[] {
	const { workflows: localWorkflows, nameSet: localWorkflowNames } = Object.entries(localWorkflowToggles)
		.filter(([_, enabled]) => enabled)
		.reduce(
			(acc, [filePath, _]) => {
				const fileName = filePath.replace(/^.*[/\\]/, "")

				// Add to array of workflows
				acc.workflows.push({
					name: fileName,
					section: "custom",
				} as SlashCommand)

				// Add to set of names
				acc.nameSet.add(fileName)

				return acc
			},
			{ workflows: [] as SlashCommand[], nameSet: new Set<string>() },
		)

	const globalWorkflows = Object.entries(globalWorkflowToggles)
		.filter(([_, enabled]) => enabled)
		.flatMap(([filePath, _]) => {
			const fileName = filePath.replace(/^.*[/\\]/, "")

			// skip if a local workflow with the same name exists
			if (localWorkflowNames.has(fileName)) {
				return []
			}

			return [
				{
					name: fileName,
					section: "custom",
				},
			] as SlashCommand[]
		})

	// Add remote workflows that are enabled
	const remoteWorkflowCommands: SlashCommand[] = []
	if (remoteWorkflows && remoteWorkflowToggles) {
		for (const workflow of remoteWorkflows) {
			// Include if alwaysEnabled or if toggle is not explicitly false
			const enabled = workflow.alwaysEnabled || remoteWorkflowToggles[workflow.name] !== false
			if (enabled) {
				remoteWorkflowCommands.push({
					name: workflow.name,
					section: "custom",
				})
			}
		}
	}

	const workflows = [...localWorkflows, ...globalWorkflows, ...remoteWorkflowCommands]
	return workflows
}

/**
 * Gets MCP prompt commands from connected MCP servers
 * Format: mcp:<server-name>:<prompt-name>
 */
export function getMcpPromptCommands(mcpServers: McpServer[] = []): SlashCommand[] {
	const commands: SlashCommand[] = []

	for (const server of mcpServers) {
		if (server.status !== "connected" || !server.prompts) {
			continue
		}

		for (const prompt of server.prompts) {
			commands.push({
				name: `mcp:${server.name}:${prompt.name}`,
				description: prompt.description || prompt.title || `MCP prompt from ${server.name}`,
				section: "mcp",
			})
		}
	}

	return commands
}

export interface PluginCommandSource {
	name: string
	description?: string
}

/**
 * Commands contributed by Claude Code plugins. Their names are namespaced
 * (`plugin:command`), so they use the chat input's own token alphabet, which
 * accepts colons, rather than the stricter skill-name check.
 */
export function getPluginCommands(commands: PluginCommandSource[] = []): SlashCommand[] {
	return commands
		.filter((command) => /^[a-zA-Z0-9_.@-]+:[a-zA-Z0-9_.@-]+$/.test(command.name))
		.map((command) => ({
			name: command.name,
			description: command.description || command.name,
			section: "custom",
		}))
}

export function getSkillCommands(skills: SkillCommandSource[] = []): SlashCommand[] {
	return skills
		.filter((skill) => skill.enabled && isSlashSafeName(skill.name))
		.map((skill) => ({
			name: `${SKILL_COMMAND_PREFIX}${skill.name}`,
			description: skill.description || skill.name,
			section: "skill",
		}))
}

export function getMcpServerCommands(mcpServers: McpServer[] = []): SlashCommand[] {
	return mcpServers
		.filter((server) => !server.disabled && isSlashSafeName(server.name))
		.map((server) => ({
			name: `${MCP_SERVER_COMMAND_PREFIX}${server.name}`,
			description: describeMcpServer(server),
			section: "mcpServer",
		}))
}

function describeMcpServer(server: McpServer): string {
	if (server.status === "connected") {
		return `已连接 · ${server.tools?.length ?? 0} 个工具`
	}
	if (server.status === "connecting") {
		return "连接中"
	}
	return "未连接"
}

function collectSlashCommands(
	localWorkflowToggles: Record<string, boolean>,
	globalWorkflowToggles: Record<string, boolean>,
	remoteWorkflowToggles: Record<string, boolean> | undefined,
	remoteWorkflows: any[] | undefined,
	mcpServers: McpServer[],
	provider: string | undefined,
	skills: SkillCommandSource[],
	pluginCommands: PluginCommandSource[] = [],
): SlashCommand[] {
	const workflowCommands = getWorkflowCommands(
		localWorkflowToggles,
		globalWorkflowToggles,
		remoteWorkflowToggles,
		remoteWorkflows,
	)
	return [
		...DEFAULT_SLASH_COMMANDS,
		...providerSlashCommands(provider),
		...workflowCommands,
		...getMcpPromptCommands(mcpServers),
		...getSkillCommands(skills),
		...getPluginCommands(pluginCommands),
		...getMcpServerCommands(mcpServers),
	]
}

// Regex for detecting slash commands in text
// Must be at start of string OR preceded by whitespace to avoid matching URLs/paths
// e.g., matches "/newtask" or "text /newtask" but not "http://example.com/newtask"
// Note: Colons are allowed to support MCP prompt commands like /mcp:server:prompt
export const slashCommandRegex = /(^|\s)(\/[a-zA-Z0-9_.:@-]+)(?=\s|$)/
export const slashCommandRegexGlobal = new RegExp(slashCommandRegex.source, "g")
// Regex for detecting a slash command at the end of text (for deletion)
// Must be at start OR preceded by whitespace, captures the whole command including slash
export const slashCommandDeleteRegex = /(^|\s)(\/[a-zA-Z0-9_.:@-]+)$/

/**
 * Removes a slash command at the cursor position
 */
export function removeSlashCommand(text: string, position: number): { newText: string; newPosition: number } {
	const beforeCursor = text.slice(0, position)
	const afterCursor = text.slice(position)

	// Check if we're at the end of a slash command (anywhere in text, not just at start)
	const matchEnd = beforeCursor.match(slashCommandDeleteRegex)

	if (matchEnd) {
		// matchEnd[1] is the whitespace or empty string before the slash
		// matchEnd[2] is the slash command (e.g., "/newtask")
		const slashCommand = matchEnd[2]
		const newText = text.slice(0, position - slashCommand.length) + afterCursor.replace(/^ /, "") // removes the space immediately after the command
		const newPosition = position - slashCommand.length
		return { newText, newPosition }
	}

	// If we're not at the end of a slash command, just return the original text and position
	return { newText: text, newPosition: position }
}

/**
 * Determines whether the slash command menu should be displayed based on text input.
 * Only shows for the FIRST valid slash command position in the message - subsequent
 * slash commands won't trigger suggestions since only one is processed per message.
 */
export function shouldShowSlashCommandsMenu(text: string, cursorPosition: number): boolean {
	const beforeCursor = text.slice(0, cursorPosition)

	// first check if there is a slash before the cursor
	const slashIndex = beforeCursor.lastIndexOf("/")

	if (slashIndex === -1) {
		return false
	}

	// Check if slash is preceded by whitespace or is at the beginning
	// This allows slash commands anywhere in the message, similar to @ mentions
	const charBeforeSlash = slashIndex > 0 ? beforeCursor[slashIndex - 1] : null
	if (charBeforeSlash !== null && !/\s/.test(charBeforeSlash)) {
		return false
	}

	// potential partial or full command
	const textAfterSlash = beforeCursor.slice(slashIndex + 1)

	// don't show menu if there's whitespace after the slash but before the cursor
	if (/\s/.test(textAfterSlash)) {
		return false
	}

	// Only show suggestions for the FIRST slash command in the message.
	// Check if there's already a valid slash command earlier in the text.
	// A valid earlier slash command is one that: starts at beginning or after whitespace,
	// and is followed by whitespace (meaning it's complete).
	// Note: Colons are allowed to support MCP prompt commands like /mcp:server:prompt
	const firstSlashCommandRegex = /(^|\s)\/[a-zA-Z0-9_.:@-]+\s/
	const textBeforeCurrentSlash = text.slice(0, slashIndex)
	if (firstSlashCommandRegex.test(textBeforeCurrentSlash)) {
		return false
	}

	return true
}

/**
 * Gets filtered slash commands that match the current input
 */
export function getMatchingSlashCommands(
	query: string,
	localWorkflowToggles: Record<string, boolean> = {},
	globalWorkflowToggles: Record<string, boolean> = {},
	remoteWorkflowToggles?: Record<string, boolean>,
	remoteWorkflows?: any[],
	mcpServers: McpServer[] = [],
	provider?: string,
	skills: SkillCommandSource[] = [],
	pluginCommands: PluginCommandSource[] = [],
): SlashCommand[] {
	const allCommands = collectSlashCommands(
		localWorkflowToggles,
		globalWorkflowToggles,
		remoteWorkflowToggles,
		remoteWorkflows,
		mcpServers,
		provider,
		skills,
		pluginCommands,
	)

	if (!query) {
		return allCommands
	}

	// filter commands that start with the query (case insensitive)
	return allCommands.filter((cmd) => cmd.name.toLowerCase().startsWith(query.toLowerCase()))
}

/**
 * Insert a slash command at position or replace partial command
 */
export function insertSlashCommand(
	text: string,
	commandName: string,
	partialCommandLength: number,
	cursorPosition: number,
): { newValue: string; commandIndex: number } {
	// Find the slash nearest to cursor (before cursor position)
	const beforeCursor = text.slice(0, cursorPosition)
	const slashIndex = beforeCursor.lastIndexOf("/")

	const beforeSlash = text.substring(0, slashIndex + 1)
	const afterPartialCommand = text.substring(slashIndex + 1 + partialCommandLength)

	// replace the partial command with the full command
	const newValue =
		beforeSlash + commandName + (afterPartialCommand.startsWith(" ") ? afterPartialCommand : " " + afterPartialCommand)

	return { newValue, commandIndex: slashIndex }
}

/**
 * Determines the validation state of a slash command
 * Returns partial if we have a partial match against valid commands, or full for full match
 */
export function validateSlashCommand(
	command: string,
	localWorkflowToggles: Record<string, boolean> = {},
	globalWorkflowToggles: Record<string, boolean> = {},
	remoteWorkflowToggles?: Record<string, boolean>,
	remoteWorkflows?: any[],
	mcpServers: McpServer[] = [],
	provider?: string,
	skills: SkillCommandSource[] = [],
	pluginCommands: PluginCommandSource[] = [],
): "full" | "partial" | null {
	if (!command) {
		return null
	}

	const allCommands = collectSlashCommands(
		localWorkflowToggles,
		globalWorkflowToggles,
		remoteWorkflowToggles,
		remoteWorkflows,
		mcpServers,
		provider,
		skills,
		pluginCommands,
	)

	// case insensitive matching
	const exactMatch = allCommands.some((cmd) => cmd.name.toLowerCase() === command.toLowerCase())

	if (exactMatch) {
		return "full"
	}

	const partialMatch = allCommands.some((cmd) => cmd.name.toLowerCase().startsWith(command.toLowerCase()))

	if (partialMatch) {
		return "partial"
	}

	return null // no match
}
