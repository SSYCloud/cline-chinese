import YAML from "yaml";

export interface ParsedClaudeCommandMarkdown {
	description?: string;
	argumentHint?: string;
	body: string;
}

const FRONTMATTER_FENCE = "---";
// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code defines this literal placeholder.
const CLAUDE_PLUGIN_ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}";

/**
 * Parse a `commands/<name>.md` prompt template. The optional YAML frontmatter
 * carries `description` and `argument-hint`; `allowed-tools` and `model` are
 * accepted but not enforced, because Cline's tool policy is not per-command.
 */
export function parseClaudeCommandMarkdown(
	content: string,
): ParsedClaudeCommandMarkdown {
	const normalized = content.replace(/^﻿/, "").replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	if (lines[0]?.trim() !== FRONTMATTER_FENCE) {
		return { body: normalized.trim() };
	}
	const closing = lines.findIndex(
		(line, index) => index > 0 && line.trim() === FRONTMATTER_FENCE,
	);
	if (closing === -1) {
		throw new Error("Command frontmatter is missing its closing '---' line.");
	}

	const frontmatter = parseFrontmatterMapping(
		lines.slice(1, closing).join("\n"),
	);
	const body = lines
		.slice(closing + 1)
		.join("\n")
		.trim();
	return {
		...(typeof frontmatter.description === "string"
			? { description: frontmatter.description.trim() }
			: {}),
		...(typeof frontmatter["argument-hint"] === "string"
			? { argumentHint: frontmatter["argument-hint"].trim() }
			: {}),
		body,
	};
}

function parseFrontmatterMapping(source: string): Record<string, unknown> {
	if (source.trim() === "") {
		return {};
	}
	const parsed: unknown = YAML.parse(source);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("Command frontmatter must be a YAML mapping.");
	}
	return parsed as Record<string, unknown>;
}

/** Substitute Claude's `$ARGUMENTS` placeholder with the text typed after the command. */
export function renderClaudeCommandPrompt(
	body: string,
	argumentsText: string,
	context: { pluginRoot: string },
): string {
	return body
		.split(CLAUDE_PLUGIN_ROOT_TOKEN)
		.join(context.pluginRoot)
		.split("$ARGUMENTS")
		.join(argumentsText.trim());
}
