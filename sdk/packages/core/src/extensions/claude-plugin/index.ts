export {
	CLAUDE_PLUGIN_EXTENSION_NAME,
	type CreateClaudePluginExtensionOptions,
	createClaudePluginExtension,
} from "./extension";
export {
	type ClaudeFunctionHooks,
	type CreateClaudeFunctionHooksOptions,
	createClaudeFunctionHooks,
} from "./function-hooks";
export {
	type ClaudePluginFunctionCommandOptions,
	type ClaudePluginInventoryOptions,
	type ClaudePluginSlashCommand,
	listClaudePluginFunctionCommands,
	listClaudePluginInventory,
	listClaudePluginSlashCommands,
	setClaudePluginEnabled,
} from "./inventory";
export { loadClaudePlugins } from "./load";
export {
	type ClaudeAvailablePlugin,
	type ClaudeCatalogSnapshot,
	ClaudeCliError,
	type ClaudeInstalledPluginRecord,
	type ClaudePluginInstallOutcome,
	installClaudePlugin,
	listClaudeMarketplaceCatalog,
} from "./marketplace";
export type {
	ClaudeHookEventName,
	ClaudePluginCommand,
	ClaudePluginComponent,
	ClaudePluginDiagnostic,
	ClaudePluginHookBinding,
	ClaudePluginHookModule,
	ClaudePluginInventoryEntry,
	ClaudePluginLoadReport,
	ClaudePluginManifest,
	ClaudePluginOptionValue,
	LoadClaudePluginsOptions,
	LoadedClaudePlugin,
} from "./types";
