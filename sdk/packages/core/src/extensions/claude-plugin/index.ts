export {
	CLAUDE_PLUGIN_EXTENSION_NAME,
	type CreateClaudePluginExtensionOptions,
	createClaudePluginExtension,
} from "./extension";
export {
	type ClaudePluginInventoryOptions,
	type ClaudePluginSlashCommand,
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
	ClaudePluginInventoryEntry,
	ClaudePluginLoadReport,
	ClaudePluginManifest,
	LoadClaudePluginsOptions,
	LoadedClaudePlugin,
} from "./types";
