import { stripUtf8Bom } from "@cline/shared";
import YAML from "yaml";
import type { ConfiguredAgentConfig } from "../tools/team/configured-agent-config";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const MAX_NAME_LENGTH = 256;
// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code defines this literal placeholder.
const CLAUDE_PLUGIN_ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}";

const CLAUDE_TO_CLINE_TOOL_NAMES: Readonly<Record<string, string>> = {
	read: "read_files",
	write: "editor",
	edit: "editor",
	multiedit: "editor",
	bash: "run_commands",
	grep: "search_codebase",
	webfetch: "fetch_web_content",
	websearch: "web_search",
	skill: "skills",
};

const UNENFORCED_AGENT_FIELDS = [
	"permissionMode",
	"hooks",
	"mcpServers",
	"initialPrompt",
	"effort",
	"autoCompactWindow",
	"memory",
	"background",
	"omitClaudeMd",
	"isolation",
	"experimental",
] as const;

export interface ParseClaudeAgentOptions {
	pluginName: string;
	pluginRoot: string;
	fileName: string;
	/** Folders between `agents/` and the file, which Claude Code joins into the name with colons. */
	subfolders: string[];
}

export interface ParsedClaudeAgent {
	config: ConfiguredAgentConfig;
	warnings: string[];
}

/**
 * Parse a plugin `agents/<name>.md` subagent. The frontmatter describes the agent
 * and the body is its system prompt. Claude fields Cline cannot honour become
 * warnings rather than errors, so the agent still loads with the parts that work.
 *
 * Tool and model limits fail closed: an unmapped tool is left out, and a model
 * alias never reaches a provider that cannot resolve it.
 */
export function parseClaudeAgentMarkdown(
	content: string,
	options: ParseClaudeAgentOptions,
): ParsedClaudeAgent {
	const match = stripUtf8Bom(content).match(FRONTMATTER_PATTERN);
	if (!match) {
		throw new Error(
			"Agent file must start with YAML frontmatter delimited by '---'.",
		);
	}
	const parsed: unknown = YAML.parse(match[1]);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Agent frontmatter must be a YAML mapping.");
	}
	const frontmatter = parsed as Record<string, unknown>;
	const systemPrompt = match[2]
		.trim()
		.split(CLAUDE_PLUGIN_ROOT_TOKEN)
		.join(options.pluginRoot);
	if (systemPrompt === "") {
		throw new Error("Agent body is empty; it is used as the system prompt.");
	}

	const localName =
		typeof frontmatter.name === "string" &&
		frontmatter.name.trim() !== "" &&
		frontmatter.name.trim().length <= MAX_NAME_LENGTH
			? frontmatter.name.trim()
			: options.fileName;
	const name = [options.pluginName, ...options.subfolders, localName].join(":");
	const warnings: string[] = [];

	const tools = mapTools(frontmatter.tools, warnings);
	const disallowed = mapDisallowedTools(frontmatter.disallowedTools);
	const finalTools =
		tools === undefined
			? undefined
			: tools.filter((tool) => !disallowed.has(tool));
	if (tools === undefined && disallowed.size > 0) {
		warnings.push(
			"disallowedTools is only applied together with tools; this agent inherits every tool.",
		);
	}

	const model = frontmatter.model;
	if (model !== undefined && model !== "inherit") {
		warnings.push(
			`model '${String(model)}' is not mapped; this agent uses the session model.`,
		);
	}

	const maxIterations = parseMaxTurns(frontmatter.maxTurns, warnings);
	for (const field of UNENFORCED_AGENT_FIELDS) {
		if (frontmatter[field] !== undefined) {
			warnings.push(`Agent field '${field}' is not supported by Cline and is ignored.`);
		}
	}

	const description =
		typeof frontmatter.description === "string" &&
		frontmatter.description.trim() !== ""
			? frontmatter.description.trim()
			: `Agent from ${options.pluginName} plugin`;
	const skills = parseSkills(frontmatter.skills);

	return {
		config: {
			name,
			description,
			systemPrompt,
			...(finalTools !== undefined ? { tools: finalTools } : {}),
			...(skills !== undefined ? { skills } : {}),
			...(maxIterations !== undefined ? { maxIterations } : {}),
		},
		warnings,
	};
}

function mapTools(value: unknown, warnings: string[]): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	const names = toStringList(value);
	const mapped = new Set<string>();
	for (const name of names) {
		const clineName = CLAUDE_TO_CLINE_TOOL_NAMES[name.toLowerCase()];
		if (clineName) {
			mapped.add(clineName);
		} else {
			warnings.push(
				`Tool '${name}' has no Cline equivalent and is not available to this agent.`,
			);
		}
	}
	return [...mapped];
}

function mapDisallowedTools(value: unknown): Set<string> {
	const blocked = new Set<string>();
	if (value === undefined) {
		return blocked;
	}
	for (const name of toStringList(value)) {
		const clineName = CLAUDE_TO_CLINE_TOOL_NAMES[name.toLowerCase()];
		if (clineName) {
			blocked.add(clineName);
		}
	}
	return blocked;
}

function parseMaxTurns(value: unknown, warnings: string[]): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value === "number" && Number.isInteger(value) && value > 0) {
		return value;
	}
	warnings.push(`maxTurns must be a positive integer; '${String(value)}' is ignored.`);
	return undefined;
}

function parseSkills(value: unknown): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return toStringList(value);
}

function toStringList(value: unknown): string[] {
	const raw = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
	return Array.from(
		new Set(
			raw
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0),
		),
	);
}
