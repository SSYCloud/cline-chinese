import type { Dirent } from "node:fs";
import { existsSync } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import {
	AGENT_PLUGIN_MANIFEST_FILE_NAME,
	CLAUDE_INSTALLED_PLUGINS_FILE_NAME,
	CLAUDE_PLUGIN_MANIFEST_RELATIVE_PATH,
	isClaudePluginDirectory,
} from "@cline/shared/storage";
import { resolveContainedExistingPath } from "../agent-plugin/loader";
import type { ClaudePluginManifest } from "./types";

const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;
const PLUGIN_NAME_MAX_LENGTH = 64;

const MANIFEST_FIELDS = new Set([
	"$schema",
	"name",
	"version",
	"description",
	"author",
	"homepage",
	"repository",
	"license",
	"keywords",
	"commands",
	"agents",
	"skills",
	"hooks",
	"mcpServers",
]);
const UNSUPPORTED_COMPONENT_FIELDS = new Set(["outputStyles", "lspServers"]);
const DEFAULT_COMPONENT_LOCATIONS: Readonly<Record<string, string>> = {
	commands: "./commands",
	skills: "./skills",
	hooks: "./hooks/hooks.json",
	mcpServers: "./.mcp.json",
};

export interface ReadClaudePluginManifestResult {
	manifestPath: string;
	manifest: ClaudePluginManifest;
	/** Manifest fields Cline ignores or only partly supports, for diagnostics. */
	warnings: string[];
	/** Hooks and MCP servers declared inline in `plugin.json` instead of a file. */
	inline: { hooks?: unknown; mcpServers?: unknown };
	/** Custom `commands` directory declared in `plugin.json`, relative to the plugin root. */
	commandsPath?: string;
	/** Custom `agents` file or directory declared in `plugin.json`, relative to the plugin root. */
	agentsPath?: string;
}

/**
 * Resolve a directory to its real path so symlinked plugin roots and component
 * paths are checked against their true location.
 */
export async function resolvePluginDirectory(path: string): Promise<string> {
	const resolved = await realpath(path);
	if (!(await stat(resolved)).isDirectory()) {
		throw new Error("expected a directory");
	}
	return resolved;
}

async function pathLocationExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Plugin roots Claude Code has installed, read from its `installed_plugins.json`
 * registry. Each entry's `installPath` is the plugin's real directory, so
 * marketplace catalogs (which hold uninstalled sources) are never picked up.
 */
export async function readInstalledClaudePluginRoots(
	storeDir: string,
): Promise<string[]> {
	let document: unknown;
	try {
		document = JSON.parse(
			await readFile(
				join(storeDir, CLAUDE_INSTALLED_PLUGINS_FILE_NAME),
				"utf8",
			),
		);
	} catch {
		return [];
	}
	if (!isRecord(document) || !isRecord(document.plugins)) {
		return [];
	}
	const roots: string[] = [];
	for (const installations of Object.values(document.plugins)) {
		if (!Array.isArray(installations)) {
			continue;
		}
		const newest = installations.filter(isRecord).at(-1);
		if (typeof newest?.installPath !== "string") {
			continue;
		}
		try {
			const root = await resolvePluginDirectory(newest.installPath);
			if (
				isClaudePluginDirectory(root) &&
				!isNativeAgentPluginDirectory(root)
			) {
				roots.push(root);
			}
		} catch {}
	}
	return [...new Set(roots)].sort((left, right) => left.localeCompare(right));
}

/**
 * Host-wide search root → plugin roots that carry a Claude manifest. A search
 * root that is Claude Code's store directory is read through its registry;
 * any other root is scanned one level deep.
 */
export async function discoverClaudePluginRoots(
	searchPath: string,
): Promise<string[]> {
	let searchRoot: string;
	try {
		searchRoot = await resolvePluginDirectory(searchPath);
	} catch {
		return [];
	}
	if (
		await pathLocationExists(
			join(searchRoot, CLAUDE_INSTALLED_PLUGINS_FILE_NAME),
		)
	) {
		return readInstalledClaudePluginRoots(searchRoot);
	}
	let entries: Dirent[];
	try {
		entries = await readdir(searchRoot, { withFileTypes: true });
	} catch {
		return [];
	}
	const roots: string[] = [];
	for (const entry of entries) {
		let candidateRoot: string;
		try {
			candidateRoot = await resolvePluginDirectory(
				join(searchRoot, entry.name),
			);
		} catch {
			continue;
		}
		if (
			isClaudePluginDirectory(candidateRoot) &&
			!isNativeAgentPluginDirectory(candidateRoot)
		) {
			roots.push(candidateRoot);
		}
	}
	return roots.sort((left, right) => left.localeCompare(right));
}

/** True when a directory is an Agent Plugin (`plugin.json`) rather than a Claude plugin. */
export function isNativeAgentPluginDirectory(path: string): boolean {
	return existsSync(join(path, AGENT_PLUGIN_MANIFEST_FILE_NAME));
}

/**
 * Read and validate `.claude-plugin/plugin.json`. Throws with a user-facing
 * message on any defect that makes the manifest unusable; non-fatal oddities
 * are returned as warnings so the plugin still loads.
 */
export async function readClaudePluginManifest(
	pluginRoot: string,
): Promise<ReadClaudePluginManifestResult> {
	const candidatePath = join(pluginRoot, CLAUDE_PLUGIN_MANIFEST_RELATIVE_PATH);
	const manifestPath = await resolveContainedExistingPath(
		pluginRoot,
		candidatePath,
		"file",
	);
	let parsed: unknown;
	try {
		parsed = JSON.parse(await readFile(manifestPath, "utf8"));
	} catch (error) {
		throw new Error(
			`Invalid plugin manifest: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!isRecord(parsed)) {
		throw new Error("plugin manifest must contain a JSON object.");
	}
	const manifest = parseManifestFields(parsed);
	return {
		manifestPath,
		manifest,
		warnings: collectManifestWarnings(parsed),
		...(typeof parsed.commands === "string"
			? { commandsPath: parsed.commands }
			: {}),
		...(typeof parsed.agents === "string" ? { agentsPath: parsed.agents } : {}),
		inline: {
			...(isRecord(parsed.hooks) ? { hooks: parsed.hooks } : {}),
			...(isRecord(parsed.mcpServers) ? { mcpServers: parsed.mcpServers } : {}),
		},
	};
}

function parseManifestFields(
	value: Record<string, unknown>,
): ClaudePluginManifest {
	if (typeof value.name !== "string") {
		throw new Error("plugin manifest field 'name' must be a string.");
	}
	if (
		value.name.length > PLUGIN_NAME_MAX_LENGTH ||
		!PLUGIN_NAME_PATTERN.test(value.name)
	) {
		throw new Error(
			`plugin manifest field 'name' must be 1-${PLUGIN_NAME_MAX_LENGTH} letters, digits, '.', '_' or '-'; got '${value.name}'.`,
		);
	}
	const manifest: ClaudePluginManifest = { name: value.name };
	const stringFields = [
		"version",
		"description",
		"homepage",
		"repository",
		"license",
	] as const;
	for (const field of stringFields) {
		if (typeof value[field] === "string") {
			manifest[field] = value[field];
		}
	}
	if (isRecord(value.author)) {
		manifest.author = pickStringFields(value.author, ["name", "email", "url"]);
	}
	if (Array.isArray(value.keywords)) {
		manifest.keywords = value.keywords.filter(
			(entry): entry is string => typeof entry === "string",
		);
	}
	return manifest;
}

function collectManifestWarnings(value: Record<string, unknown>): string[] {
	const warnings: string[] = [];
	for (const field of Object.keys(value).sort()) {
		if (UNSUPPORTED_COMPONENT_FIELDS.has(field)) {
			warnings.push(
				`Manifest field '${field}' is not supported by Cline and is ignored.`,
			);
		} else if (!MANIFEST_FIELDS.has(field)) {
			warnings.push(`Ignoring unknown plugin manifest field '${field}'.`);
		}
	}
	for (const [field, defaultLocation] of Object.entries(
		DEFAULT_COMPONENT_LOCATIONS,
	)) {
		if (field === "commands") {
			continue;
		}
		const declared = value[field];
		if (
			typeof declared === "string" &&
			normalizeLocation(declared) !== normalizeLocation(defaultLocation)
		) {
			warnings.push(
				`Custom '${field}' location '${declared}' is not supported; Cline reads '${defaultLocation}' instead.`,
			);
		}
	}
	return warnings;
}

function normalizeLocation(location: string): string {
	return location.replace(/^\.\//, "").replace(/\/+$/, "");
}

function pickStringFields(
	source: Record<string, unknown>,
	fields: ReadonlyArray<string>,
): Record<string, string> {
	const picked: Record<string, string> = {};
	for (const field of fields) {
		if (typeof source[field] === "string") {
			picked[field] = source[field];
		}
	}
	return picked;
}
