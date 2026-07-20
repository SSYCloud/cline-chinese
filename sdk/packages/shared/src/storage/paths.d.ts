export declare const AGENT_CONFIG_DIRECTORY_NAME = "agents";
export declare const HOOKS_CONFIG_DIRECTORY_NAME = "hooks";
export declare const SKILLS_CONFIG_DIRECTORY_NAME = "skills";
export declare const RULES_CONFIG_DIRECTORY_NAME = "rules";
export declare const WORKFLOWS_CONFIG_DIRECTORY_NAME = "workflows";
export declare const PLUGINS_DIRECTORY_NAME = "plugins";
export declare const AGENTS_RULES_FILE_NAME = "AGENTS.md";
export declare const CLINE_MCP_SETTINGS_FILE_NAME = "cline_mcp_settings.json";
export declare function setHomeDir(dir: string): void;
export declare function setHomeDirIfUnset(dir: string): void;
export declare function setClineDir(dir: string): void;
export declare function setClineDirIfUnset(dir: string): void;
export declare function resolveClineDir(): string;
export declare function resolveDocumentsClineDirectoryPath(): string;
type DocumentsExtensionName =
	| "Agents"
	| "Hooks"
	| "Rules"
	| "Workflows"
	| "Plugins";
export declare function resolveDocumentsExtensionPath(
	name: DocumentsExtensionName,
): string;
export declare function resolveClineDataDir(): string;
export declare function resolveSessionDataDir(): string;
export declare function resolveTeamDataDir(): string;
export declare function resolveDbDataDir(): string;
/**
 * Path to the dedicated cron/automation database.
 * Lives alongside `sessions.db` but is a separate file so cron lifecycle,
 * retention, and query patterns stay decoupled from session storage.
 */
export declare function resolveCronDbPath(): string;
export type CronSpecsScope = "global" | "workspace";
export interface ResolveCronSpecsDirOptions {
	/**
	 * Explicit specs directory. Useful for tests and for future hosts that want
	 * to provide their own merged/global/workspace cron source root.
	 */
	cronSpecsDir?: string;
	/** Defaults to `global`, i.e. `~/.cline/cron`. */
	scope?: CronSpecsScope;
	/** Required when `scope` is `workspace`. */
	workspaceRoot?: string;
}
/**
 * Global file-based cron spec authoring directory:
 *   `~/.cline/cron/`
 */
export declare function resolveGlobalCronSpecsDir(): string;
/**
 * Workspace file-based cron spec authoring directory reserved for future
 * workspace-scoped automation support:
 *   `${workspaceRoot}/.cline/cron/`
 */
export declare function resolveWorkspaceCronSpecsDir(
	workspaceRoot: string,
): string;
/**
 * Directory containing file-based cron spec authoring.
 *
 * Default: global `~/.cline/cron/`.
 * One-off: `*.md`
 * Recurring: `*.cron.md`
 * Event-driven: `events/*.event.md`
 *
 * A string argument is retained as a deprecated compatibility shorthand for
 * workspace scope. New code should pass `{ scope: "workspace", workspaceRoot }`
 * or use `resolveWorkspaceCronSpecsDir(workspaceRoot)` directly.
 */
export declare function resolveCronSpecsDir(workspaceRoot: string): string;
export declare function resolveCronSpecsDir(
	options?: ResolveCronSpecsDirOptions,
): string;
/** Directory where per-run markdown reports are written. */
export declare function resolveCronReportsDir(workspaceRoot: string): string;
export declare function resolveCronReportsDir(
	options?: ResolveCronSpecsDirOptions,
): string;
/** Directory where event-spec files live inside the cron specs dir. */
export declare function resolveCronEventsDir(workspaceRoot: string): string;
export declare function resolveCronEventsDir(
	options?: ResolveCronSpecsDirOptions,
): string;
export declare function resolveProviderSettingsPath(): string;
export declare function resolveGlobalSettingsPath(): string;
export declare function resolveMcpSettingsPath(): string;
export declare function resolveAgentsConfigDirPath(): string;
export declare function resolveAgentConfigSearchPaths(
	workspacePath?: string,
): string[];
export declare function resolveHooksConfigSearchPaths(
	workspacePath?: string,
): string[];
export declare function resolveSkillsConfigSearchPaths(
	workspacePath?: string,
): string[];
export declare function resolveGlobalAgentsRulesPath(): string;
export declare function resolveRulesConfigSearchPaths(
	workspacePath?: string,
): string[];
export declare function resolveWorkflowsConfigSearchPaths(
	workspacePath?: string,
): string[];
export declare function resolvePluginConfigSearchPaths(
	workspacePath?: string,
): string[];
export declare function isPluginModulePath(path: string): boolean;
export declare function resolvePluginModuleEntries(
	directoryPath: string,
): string[] | null;
export declare function discoverPluginModulePaths(
	directoryPath: string,
): string[];
export declare function resolveConfiguredPluginModulePaths(
	pluginPaths: ReadonlyArray<string>,
	cwd: string,
): string[];
export declare function ensureParentDir(filePath: string): void;
export declare function ensureFileExists(filePath: string): void;
export declare function ensureHookLogDir(filePath?: string): string;
export {};
