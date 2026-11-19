import type { Dirent } from "node:fs";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
	AGENT_PLUGINS_V1_MCP_SCHEMA,
	loadSkills,
	resolveContainedExistingPath,
	resolveMcpServersFromDocument,
	resolvePluginDataPath,
} from "../agent-plugin/loader";
import type {
	AgentPluginPackageDiagnostic,
	AgentPluginPackageMcpServer,
	AgentPluginPackageSkill,
} from "../agent-plugin/types";
import type { ConfiguredAgentConfig } from "../tools/team/configured-agent-config";
import { parseClaudeAgentMarkdown } from "./agents";
import { parseClaudeCommandMarkdown } from "./commands";
import { parseClaudeHooksDocument } from "./hook-config";
import { parseClaudeSkillMarkdown } from "./skills";
import type {
	ClaudePluginCommand,
	ClaudePluginComponent,
	ClaudePluginDiagnostic,
	ClaudePluginHookBinding,
} from "./types";

const MCP_CONFIG_FILE_NAME = ".mcp.json";
const HOOKS_CONFIG_RELATIVE_PATH = join("hooks", "hooks.json");
const COMMANDS_DIRECTORY_NAME = "commands";
// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code defines these exact literal placeholders.
const CLAUDE_PLUGIN_ROOT_PLACEHOLDER = "${CLAUDE_PLUGIN_ROOT}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code defines these exact literal placeholders.
const CLAUDE_PLUGIN_DATA_PLACEHOLDER = "${CLAUDE_PLUGIN_DATA}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: Agent Plugins validator placeholder literal.
const AGENT_PLUGIN_ROOT_PLACEHOLDER = "${PLUGIN_ROOT}";
// biome-ignore lint/suspicious/noTemplateCurlyInString: Agent Plugins validator placeholder literal.
const AGENT_PLUGIN_DATA_PLACEHOLDER = "${PLUGIN_DATA}";

export interface ClaudePluginComponentContext {
	pluginRoot: string;
	pluginName: string;
	pluginDataRoot: string;
	/** Hooks / MCP servers declared inline in `plugin.json` instead of in their own files. */
	inline: { hooks?: unknown; mcpServers?: unknown };
	commandsPath?: string;
	agentsPath?: string;
}

export interface ClaudePluginComponentResult {
	skills: AgentPluginPackageSkill[];
	mcpServers: AgentPluginPackageMcpServer[];
	commands: ClaudePluginCommand[];
	agents: ConfiguredAgentConfig[];
	hooks: ClaudePluginHookBinding[];
	diagnostics: ClaudePluginDiagnostic[];
}

/**
 * Load every component of one Claude plugin. Components are isolated from each
 * other: a broken MCP file does not stop the plugin's skills or hooks loading.
 */
export async function loadClaudePluginComponents(
	context: ClaudePluginComponentContext,
): Promise<ClaudePluginComponentResult> {
	const diagnostics: ClaudePluginDiagnostic[] = [];
	const nativeDiagnostics: AgentPluginPackageDiagnostic[] = [];
	const pluginDataPath = resolvePluginDataPath(
		context.pluginDataRoot,
		context.pluginName,
		context.pluginRoot,
	);

	const skills =
		(await guarded("skills", context, diagnostics, () =>
			loadSkills(
				context.pluginRoot,
				context.pluginName,
				nativeDiagnostics,
				parseClaudeSkillMarkdown,
			),
		)) ?? [];
	const mcpServers =
		(await guarded("mcp", context, diagnostics, () =>
			loadMcpServers(context, nativeDiagnostics),
		)) ?? [];
	const commands =
		(await guarded("commands", context, diagnostics, () =>
			loadCommands(context),
		)) ?? [];
	const agents =
		(await guarded("agents", context, diagnostics, () =>
			loadAgents(context, diagnostics),
		)) ?? [];
	const hooks =
		(await guarded("hooks", context, diagnostics, () =>
			loadHooks(context, pluginDataPath, diagnostics),
		)) ?? [];

	return {
		skills,
		mcpServers,
		commands,
		agents,
		hooks,
		diagnostics: [
			...diagnostics,
			...nativeDiagnostics.map((item) => fromNativeDiagnostic(item, context)),
		],
	};
}

async function guarded<T>(
	component: ClaudePluginComponent,
	context: ClaudePluginComponentContext,
	diagnostics: ClaudePluginDiagnostic[],
	load: () => Promise<T>,
): Promise<T | undefined> {
	try {
		return await load();
	} catch (error) {
		diagnostics.push({
			level: "error",
			component,
			pluginPath: context.pluginRoot,
			pluginName: context.pluginName,
			message: `Skipping ${component} for this plugin: ${errorMessage(error)}`,
		});
		return undefined;
	}
}

async function loadMcpServers(
	context: ClaudePluginComponentContext,
	nativeDiagnostics: AgentPluginPackageDiagnostic[],
): Promise<AgentPluginPackageMcpServer[]> {
	let servers: Record<string, unknown>;
	let componentPath: string;
	if (isRecord(context.inline.mcpServers)) {
		servers = context.inline.mcpServers;
		componentPath = join(context.pluginRoot, "plugin.json");
	} else {
		const candidatePath = join(context.pluginRoot, MCP_CONFIG_FILE_NAME);
		if (!(await pathExists(candidatePath))) {
			return [];
		}
		componentPath = await resolveContainedExistingPath(
			context.pluginRoot,
			candidatePath,
			"file",
		);
		const document = JSON.parse(
			await readFile(componentPath, "utf8"),
		) as unknown;
		if (!isRecord(document) || !isRecord(document.mcpServers)) {
			throw new Error(
				`${MCP_CONFIG_FILE_NAME} must contain an 'mcpServers' object.`,
			);
		}
		servers = document.mcpServers;
	}

	return resolveMcpServersFromDocument(
		{
			$schema: AGENT_PLUGINS_V1_MCP_SCHEMA,
			mcpServers: rewriteServerPlaceholders(servers),
		},
		{
			componentPath,
			pluginRoot: context.pluginRoot,
			pluginName: context.pluginName,
			pluginDataRoot: context.pluginDataRoot,
			diagnostics: nativeDiagnostics,
		},
	);
}

/**
 * The shared MCP validator only accepts Agent Plugins' placeholder spelling, so
 * Claude's `${CLAUDE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_DATA}` are rewritten first.
 * A leading root placeholder in a stdio command becomes `./`, the one command
 * form the validator accepts for files inside the plugin.
 */
function rewriteServerPlaceholders(
	servers: Record<string, unknown>,
): Record<string, unknown> {
	const text = JSON.stringify(servers)
		.split(CLAUDE_PLUGIN_ROOT_PLACEHOLDER)
		.join(AGENT_PLUGIN_ROOT_PLACEHOLDER)
		.split(CLAUDE_PLUGIN_DATA_PLACEHOLDER)
		.join(AGENT_PLUGIN_DATA_PLACEHOLDER);
	const rewritten = JSON.parse(text) as Record<string, unknown>;
	const rootPrefix = `${AGENT_PLUGIN_ROOT_PLACEHOLDER}/`;
	for (const server of Object.values(rewritten)) {
		if (
			isRecord(server) &&
			typeof server.command === "string" &&
			server.command.startsWith(rootPrefix)
		) {
			server.command = `./${server.command.slice(rootPrefix.length)}`;
		}
	}
	return rewritten;
}

async function loadCommands(
	context: ClaudePluginComponentContext,
): Promise<ClaudePluginCommand[]> {
	const directory = join(
		context.pluginRoot,
		context.commandsPath ?? COMMANDS_DIRECTORY_NAME,
	);
	if (!(await pathExists(directory))) {
		return [];
	}
	const commandsRoot = await resolveContainedExistingPath(
		context.pluginRoot,
		directory,
		"directory",
	);
	const entries: Dirent[] = await readdir(commandsRoot, {
		withFileTypes: true,
	});
	const commands: ClaudePluginCommand[] = [];
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		if (!entry.name.endsWith(".md")) {
			continue;
		}
		const filePath = await resolveContainedExistingPath(
			context.pluginRoot,
			join(commandsRoot, entry.name),
			"file",
		);
		const name = basename(entry.name, ".md");
		const parsed = parseClaudeCommandMarkdown(await readFile(filePath, "utf8"));
		commands.push({
			pluginName: context.pluginName,
			pluginRoot: context.pluginRoot,
			name,
			runtimeName: `${context.pluginName}:${name}`,
			...(parsed.description ? { description: parsed.description } : {}),
			...(parsed.argumentHint ? { argumentHint: parsed.argumentHint } : {}),
			body: parsed.body,
			filePath,
		});
	}
	return commands;
}

const AGENTS_DIRECTORY_NAME = "agents";

async function loadAgents(
	context: ClaudePluginComponentContext,
	diagnostics: ClaudePluginDiagnostic[],
): Promise<ConfiguredAgentConfig[]> {
	const target = join(context.pluginRoot, context.agentsPath ?? AGENTS_DIRECTORY_NAME);
	if (!(await pathExists(target))) {
		return [];
	}
	const kind = (await stat(target)).isDirectory() ? "directory" : "file";
	const root = await resolveContainedExistingPath(context.pluginRoot, target, kind);
	const files =
		kind === "file"
			? [{ filePath: root, subfolders: [] as string[] }]
			: await collectAgentFiles(context, root, [], diagnostics);

	const agents: ConfiguredAgentConfig[] = [];
	for (const { filePath, subfolders } of files) {
		try {
			const parsed = parseClaudeAgentMarkdown(await readFile(filePath, "utf8"), {
				pluginName: context.pluginName,
				pluginRoot: context.pluginRoot,
				fileName: basename(filePath, ".md"),
				subfolders,
			});
			for (const warning of parsed.warnings) {
				diagnostics.push({
					level: "warning",
					component: "agents",
					pluginPath: context.pluginRoot,
					pluginName: context.pluginName,
					componentPath: filePath,
					message: warning,
				});
			}
			agents.push(parsed.config);
		} catch (error) {
			diagnostics.push({
				level: "error",
				component: "agents",
				pluginPath: context.pluginRoot,
				pluginName: context.pluginName,
				componentPath: filePath,
				message: `Skipping agent: ${errorMessage(error)}`,
			});
		}
	}
	return agents;
}

async function collectAgentFiles(
	context: ClaudePluginComponentContext,
	directory: string,
	subfolders: string[],
	diagnostics: ClaudePluginDiagnostic[],
): Promise<Array<{ filePath: string; subfolders: string[] }>> {
	const entries: Dirent[] = await readdir(directory, { withFileTypes: true });
	const found: Array<{ filePath: string; subfolders: string[] }> = [];
	for (const entry of entries.sort((left, right) =>
		left.name.localeCompare(right.name),
	)) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			found.push(
				...(await collectAgentFiles(
					context,
					entryPath,
					[...subfolders, entry.name],
					diagnostics,
				)),
			);
			continue;
		}
		if (!entry.name.endsWith(".md")) {
			continue;
		}
		try {
			const filePath = await resolveContainedExistingPath(
				context.pluginRoot,
				entryPath,
				"file",
			);
			found.push({ filePath, subfolders });
		} catch (error) {
			diagnostics.push({
				level: "error",
				component: "agents",
				pluginPath: context.pluginRoot,
				pluginName: context.pluginName,
				componentPath: entryPath,
				message: `Skipping agent: ${errorMessage(error)}`,
			});
		}
	}
	return found;
}

async function loadHooks(
	context: ClaudePluginComponentContext,
	pluginDataPath: string,
	diagnostics: ClaudePluginDiagnostic[],
): Promise<ClaudePluginHookBinding[]> {
	const document = await readHooksDocument(context);
	if (document === undefined) {
		return [];
	}
	const parsed = parseClaudeHooksDocument(document);
	for (const problem of parsed.problems) {
		diagnostics.push({
			level: "warning",
			component: "hooks",
			pluginPath: context.pluginRoot,
			pluginName: context.pluginName,
			message: problem,
		});
	}
	return parsed.bindings.map((binding) => ({
		...binding,
		pluginName: context.pluginName,
		pluginRoot: context.pluginRoot,
		pluginDataPath,
	}));
}

async function readHooksDocument(
	context: ClaudePluginComponentContext,
): Promise<unknown> {
	if (context.inline.hooks !== undefined) {
		return { hooks: context.inline.hooks };
	}
	const candidatePath = join(context.pluginRoot, HOOKS_CONFIG_RELATIVE_PATH);
	if (!(await pathExists(candidatePath))) {
		return undefined;
	}
	const hooksPath = await resolveContainedExistingPath(
		context.pluginRoot,
		candidatePath,
		"file",
	);
	return JSON.parse(await readFile(hooksPath, "utf8")) as unknown;
}

function fromNativeDiagnostic(
	item: AgentPluginPackageDiagnostic,
	context: ClaudePluginComponentContext,
): ClaudePluginDiagnostic {
	const isSkill = item.scope === "skills" || item.scope === "skill";
	return {
		level: item.level,
		component: isSkill ? "skills" : "mcp",
		pluginPath: context.pluginRoot,
		pluginName: context.pluginName,
		...(item.componentPath ? { componentPath: item.componentPath } : {}),
		message: item.message,
	};
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
