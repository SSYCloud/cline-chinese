import type { AgentExtensionCommand, BasicLogger } from "@cline/shared";
import { setDisabledAgentPlugin } from "../../services/global-settings";
import { createClaudeFunctionHooks } from "./function-hooks";
import { loadClaudePlugins } from "./load";
import type {
	ClaudePluginInventoryEntry,
	ClaudePluginOptionValue,
} from "./types";

export interface ClaudePluginInventoryOptions {
	cwd?: string;
	pluginPaths?: ReadonlyArray<string>;
	searchPaths?: ReadonlyArray<string>;
	pluginDataRoot?: string;
}

/**
 * List every Claude Code plugin this host can see, with its enabled state, for a
 * host UI. Disabled names come from the same `disabledAgentPlugins` setting the
 * session loader reads, so what the UI shows matches what a session loads.
 */
export async function listClaudePluginInventory(
	options: ClaudePluginInventoryOptions = {},
): Promise<ClaudePluginInventoryEntry[]> {
	const report = await loadClaudePlugins(options);
	return report.inventory;
}

/**
 * Turn a Claude plugin on or off by name. Takes effect for sessions started
 * afterwards; the plugin's files on disk are not touched.
 */
export function setClaudePluginEnabled(name: string, enabled: boolean): void {
	const trimmed = name.trim();
	if (!trimmed) {
		throw new Error("Claude plugin name is required.");
	}
	setDisabledAgentPlugin(trimmed, !enabled);
}

export interface ClaudePluginSlashCommand {
	name: string;
	description?: string;
	argumentHint?: string;
	/** The command body with `${CLAUDE_PLUGIN_ROOT}` filled in; `$ARGUMENTS` is left for the caller. */
	template: string;
}

/**
 * Slash commands contributed by enabled Claude plugins, as name + prompt
 * template. Hosts build their `/` menu from this list and fill `$ARGUMENTS`
 * with the text typed after the command, so the same rendering applies to menu
 * entries and to typed commands.
 */
export async function listClaudePluginSlashCommands(
	options: ClaudePluginInventoryOptions = {},
): Promise<ClaudePluginSlashCommand[]> {
	const report = await loadClaudePlugins(options);
	return report.plugins.flatMap((plugin) =>
		plugin.commands.map((command) => ({
			name: command.runtimeName,
			...(command.description ? { description: command.description } : {}),
			...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
			template: command.body
				.split("${CLAUDE_PLUGIN_ROOT}")
				.join(command.pluginRoot),
		})),
	);
}

export interface ClaudePluginFunctionCommandOptions
	extends ClaudePluginInventoryOptions {
	pluginOptions?: Readonly<
		Record<string, Readonly<Record<string, ClaudePluginOptionValue>>>
	>;
	logger?: BasicLogger;
}

/**
 * Slash commands that enabled Claude plugins register from function-hook
 * modules (`/prune-tests`, for example). Unlike {@link listClaudePluginSlashCommands}
 * these run code instead of expanding a prompt template, so a host runs them by
 * calling `handler(args)` and showing the reply.
 */
export async function listClaudePluginFunctionCommands(
	options: ClaudePluginFunctionCommandOptions = {},
): Promise<AgentExtensionCommand[]> {
	const report = await loadClaudePlugins(options);
	const hooks = await createClaudeFunctionHooks({
		modules: report.plugins.flatMap((plugin) => plugin.hookModules),
		cwd: options.cwd ?? process.cwd(),
		logger: options.logger,
	});
	return hooks.commands;
}
