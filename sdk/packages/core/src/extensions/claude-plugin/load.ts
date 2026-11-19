import { join, resolve } from "node:path";
import {
	CLAUDE_PLUGIN_MANIFEST_RELATIVE_PATH,
	isClaudePluginDirectory,
	resolveClaudePluginSearchPaths,
	resolveClineDataDir,
} from "@cline/shared/storage";
import { loadClaudePluginComponents } from "./components";
import {
	discoverClaudePluginRoots,
	isNativeAgentPluginDirectory,
	readClaudePluginManifest,
	resolvePluginDirectory,
} from "./manifest";
import type {
	ClaudePluginDiagnostic,
	ClaudePluginInventoryEntry,
	ClaudePluginLoadReport,
	LoadClaudePluginsOptions,
	LoadedClaudePlugin,
} from "./types";

const CLAUDE_PLUGIN_DATA_DIRECTORY_NAME = "claude-plugins";

/**
 * Discover and load Claude Code plugins from host-local directories. Pure
 * discovery: no plugin code runs here. Hook commands run later, per event.
 */
export async function loadClaudePlugins(
	options: LoadClaudePluginsOptions = {},
): Promise<ClaudePluginLoadReport> {
	const diagnostics: ClaudePluginDiagnostic[] = [];
	const cwd = resolve(options.cwd ?? process.cwd());
	const candidateRoots = await resolveCandidateRoots(options, cwd, diagnostics);
	const pluginDataRoot = resolve(
		options.pluginDataRoot ??
			join(resolveClineDataDir(), CLAUDE_PLUGIN_DATA_DIRECTORY_NAME),
	);
	const disabledNames = normalizeNames(options.disabledPluginNames);
	const reservedNames = normalizeNames(options.reservedPluginNames);

	const plugins: LoadedClaudePlugin[] = [];
	const inventory: ClaudePluginInventoryEntry[] = [];
	const selectedRoots = new Map<string, string>();

	for (const pluginRoot of candidateRoots) {
		let manifestRead: Awaited<ReturnType<typeof readClaudePluginManifest>>;
		try {
			manifestRead = await readClaudePluginManifest(pluginRoot);
		} catch (error) {
			diagnostics.push({
				level: "error",
				component: "manifest",
				pluginPath: pluginRoot,
				componentPath: join(pluginRoot, CLAUDE_PLUGIN_MANIFEST_RELATIVE_PATH),
				message: `Rejecting Claude plugin: ${errorMessage(error)}`,
			});
			continue;
		}

		const pluginName = manifestRead.manifest.name;
		for (const warning of manifestRead.warnings) {
			diagnostics.push({
				level: "warning",
				component: "manifest",
				pluginPath: pluginRoot,
				pluginName,
				message: warning,
			});
		}

		const selectedRoot = selectedRoots.get(pluginName);
		if (selectedRoot !== undefined) {
			diagnostics.push({
				level: "warning",
				component: "manifest",
				pluginPath: pluginRoot,
				pluginName,
				message: `Ignoring duplicate Claude plugin '${pluginName}'; '${selectedRoot}' has precedence.`,
			});
			continue;
		}
		selectedRoots.set(pluginName, pluginRoot);

		if (reservedNames.has(pluginName)) {
			diagnostics.push({
				level: "warning",
				component: "manifest",
				pluginPath: pluginRoot,
				pluginName,
				message: `Skipping Claude plugin '${pluginName}': a plugin with the same name is already loaded from another format.`,
			});
			continue;
		}
		if (disabledNames.has(pluginName)) {
			inventory.push({
				name: pluginName,
				rootPath: pluginRoot,
				manifest: manifestRead.manifest,
				enabled: false,
			});
			continue;
		}

		const components = await loadClaudePluginComponents({
			pluginRoot,
			pluginName,
			pluginDataRoot,
			inline: manifestRead.inline,
			commandsPath: manifestRead.commandsPath,
			agentsPath: manifestRead.agentsPath,
		});
		diagnostics.push(...components.diagnostics);
		inventory.push({
			name: pluginName,
			rootPath: pluginRoot,
			manifest: manifestRead.manifest,
			enabled: true,
		});
		plugins.push({
			rootPath: pluginRoot,
			manifestPath: manifestRead.manifestPath,
			manifest: manifestRead.manifest,
			skills: components.skills,
			mcpServers: components.mcpServers,
			commands: components.commands,
			agents: components.agents,
			hooks: components.hooks,
		});
	}

	return {
		plugins,
		inventory,
		skills: plugins.flatMap((plugin) => plugin.skills),
		mcpServers: plugins.flatMap((plugin) => plugin.mcpServers),
		agents: plugins.flatMap((plugin) => plugin.agents),
		diagnostics,
	};
}

async function resolveCandidateRoots(
	options: LoadClaudePluginsOptions,
	cwd: string,
	diagnostics: ClaudePluginDiagnostic[],
): Promise<string[]> {
	const candidates: string[] = [];
	for (const configuredPath of options.pluginPaths ?? []) {
		const trimmed = configuredPath.trim();
		if (!trimmed) {
			continue;
		}
		const absolutePath = resolve(cwd, trimmed);
		let pluginRoot: string;
		try {
			pluginRoot = await resolvePluginDirectory(absolutePath);
		} catch (error) {
			diagnostics.push({
				level: "error",
				component: "manifest",
				pluginPath: absolutePath,
				message: `Cannot load Claude plugin directory: ${errorMessage(error)}`,
			});
			continue;
		}
		if (isClaudePluginDirectory(pluginRoot)) {
			candidates.push(pluginRoot);
		} else if (!isNativeAgentPluginDirectory(pluginRoot)) {
			diagnostics.push({
				level: "error",
				component: "manifest",
				pluginPath: pluginRoot,
				message: `Not a Claude Code plugin: missing ${CLAUDE_PLUGIN_MANIFEST_RELATIVE_PATH}.`,
			});
		}
	}

	const searchPaths = options.searchPaths ?? resolveClaudePluginSearchPaths();
	for (const searchPath of searchPaths) {
		candidates.push(...(await discoverClaudePluginRoots(searchPath)));
	}
	return [...new Set(candidates)];
}

function normalizeNames(names: ReadonlyArray<string> | undefined): Set<string> {
	return new Set(
		(names ?? []).map((name) => name.trim()).filter((name) => name.length > 0),
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
