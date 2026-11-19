import type {
	AgentExtension,
	AgentExtensionCommand,
	BasicLogger,
} from "@cline/shared";
import { markPluginCommand } from "../plugin/plugin-command-origin";
import { renderClaudeCommandPrompt } from "./commands";
import { createClaudeHookBridge } from "./hook-bridge";
import type { ClaudePluginCommand, LoadedClaudePlugin } from "./types";

export const CLAUDE_PLUGIN_EXTENSION_NAME = "core.claude-plugins";

export interface CreateClaudePluginExtensionOptions {
	plugins: ReadonlyArray<LoadedClaudePlugin>;
	cwd: string;
	logger?: BasicLogger;
}

/**
 * Package loaded Claude plugins as one `AgentExtension`. Hooks and commands are
 * contributed here; skills and MCP servers are returned separately by the loader
 * so they flow through the same pipes as native Agent Plugins.
 *
 * Returns undefined when no plugin contributes hooks or commands, so the session
 * gains no extension at all.
 */
export function createClaudePluginExtension(
	options: CreateClaudePluginExtensionOptions,
): AgentExtension | undefined {
	const hookBindings = options.plugins.flatMap((plugin) => plugin.hooks);
	const commands = options.plugins.flatMap((plugin) => plugin.commands);
	const hooks = createClaudeHookBridge({
		bindings: hookBindings,
		cwd: options.cwd,
		logger: options.logger,
	});
	if (!hooks && commands.length === 0) {
		return undefined;
	}

	const capabilities: AgentExtension["manifest"]["capabilities"] = [];
	if (hooks) {
		capabilities.push("hooks");
	}
	if (commands.length > 0) {
		capabilities.push("commands");
	}

	return {
		name: CLAUDE_PLUGIN_EXTENSION_NAME,
		manifest: { capabilities },
		...(hooks ? { hooks } : {}),
		setup: (api) => {
			for (const command of commands) {
				api.registerCommand(markPluginCommand(toCommand(command)));
			}
		},
	};
}

function toCommand(command: ClaudePluginCommand): AgentExtensionCommand {
	return {
		name: command.runtimeName,
		...(command.description ? { description: command.description } : {}),
		handler: (input) => ({
			submitPrompt: renderClaudeCommandPrompt(command.body, input, {
				pluginRoot: command.pluginRoot,
			}),
		}),
	};
}
