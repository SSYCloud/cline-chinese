import type {
	AgentPluginPackageMcpServer,
	AgentPluginPackageSkill,
} from "../agent-plugin/types";
import type { ConfiguredAgentConfig } from "../tools/team/configured-agent-config";

/**
 * Hook events Claude Code defines. Events listed in {@link CLAUDE_HOOK_EVENT_BINDINGS}
 * with a Cline mapping are executed; the rest are reported as diagnostics so a
 * plugin author can see exactly what Cline ignored.
 */
export type ClaudeHookEventName =
	| "PreToolUse"
	| "PostToolUse"
	| "PostToolUseFailure"
	| "UserPromptSubmit"
	| "SessionStart"
	| "Stop"
	| "SubagentStop"
	| "PreCompact"
	| "Notification"
	| "SessionEnd";

export interface ClaudePluginManifest {
	name: string;
	version?: string;
	description?: string;
	author?: { name?: string; email?: string; url?: string };
	homepage?: string;
	repository?: string;
	license?: string;
	keywords?: string[];
}

export type ClaudePluginComponent =
	| "manifest"
	| "skills"
	| "commands"
	| "agents"
	| "hooks"
	| "mcp";

export interface ClaudePluginDiagnostic {
	level: "warning" | "error";
	component: ClaudePluginComponent;
	pluginPath: string;
	pluginName?: string;
	componentPath?: string;
	message: string;
}

/**
 * A `commands/<name>.md` prompt template. `runtimeName` is the slash command
 * the user types: `<plugin>:<name>`, the namespacing Claude Code uses so two
 * plugins can ship the same command name.
 */
export interface ClaudePluginCommand {
	pluginName: string;
	pluginRoot: string;
	name: string;
	runtimeName: string;
	description?: string;
	argumentHint?: string;
	body: string;
	filePath: string;
}

export interface ClaudePluginHookBinding {
	pluginName: string;
	pluginRoot: string;
	pluginDataPath: string;
	event: ClaudeHookEventName;
	matcher?: string;
	command: string;
	timeoutSeconds: number;
}

export interface LoadedClaudePlugin {
	rootPath: string;
	manifestPath: string;
	manifest: ClaudePluginManifest;
	skills: AgentPluginPackageSkill[];
	mcpServers: AgentPluginPackageMcpServer[];
	commands: ClaudePluginCommand[];
	agents: ConfiguredAgentConfig[];
	hooks: ClaudePluginHookBinding[];
}

/**
 * Every Claude plugin discovered on the host, enabled or not. Disabled plugins
 * appear here without their components being loaded, so a host can list them
 * and offer to turn them back on.
 */
export interface ClaudePluginInventoryEntry {
	name: string;
	rootPath: string;
	manifest: ClaudePluginManifest;
	enabled: boolean;
}

export interface ClaudePluginLoadReport {
	plugins: LoadedClaudePlugin[];
	inventory: ClaudePluginInventoryEntry[];
	skills: AgentPluginPackageSkill[];
	mcpServers: AgentPluginPackageMcpServer[];
	agents: ConfiguredAgentConfig[];
	diagnostics: ClaudePluginDiagnostic[];
}

export interface LoadClaudePluginsOptions {
	/** Explicit plugin roots, resolved on the runtime host relative to `cwd`. */
	pluginPaths?: ReadonlyArray<string>;
	/** Base directory for resolving relative explicit plugin paths. */
	cwd?: string;
	/** Override the automatic host-wide search roots. */
	searchPaths?: ReadonlyArray<string>;
	/** Override the persistent plugin data root (`${CLAUDE_PLUGIN_DATA}`). */
	pluginDataRoot?: string;
	/** Plugin names the host has turned off. Disabled names still reserve precedence. */
	disabledPluginNames?: ReadonlyArray<string>;
	/**
	 * Plugin names already claimed by another loader (for example a native Agent
	 * Plugin). A Claude plugin with one of these names is skipped, so the two
	 * formats never contribute the same runtime names twice.
	 */
	reservedPluginNames?: ReadonlyArray<string>;
}
