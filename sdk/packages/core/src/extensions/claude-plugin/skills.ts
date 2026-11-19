import { stripUtf8Bom } from "@cline/shared";
import YAML from "yaml";
import type { ParsedAgentSkill } from "../agent-plugin/agent-skill";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const MAX_NAME_LENGTH = 64;

/**
 * Parse a Claude Code `SKILL.md`. Claude adds fields beyond the Agent Skills
 * spec (`disable-model-invocation`, `allowed-tools`, `model`, and others), so
 * unknown keys are kept on `frontmatter` rather than rejected. Only the name and
 * description have to be present and well-formed.
 */
export function parseClaudeSkillMarkdown(
	content: string,
	directoryName: string,
): ParsedAgentSkill {
	const match = stripUtf8Bom(content).match(FRONTMATTER_PATTERN);
	if (!match) {
		throw new Error(
			"SKILL.md must start with YAML frontmatter delimited by '---'.",
		);
	}
	const parsed: unknown = YAML.parse(match[1]);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error("SKILL.md frontmatter must be a YAML mapping.");
	}
	const frontmatter = parsed as Record<string, unknown>;

	const name =
		typeof frontmatter.name === "string" && frontmatter.name.trim() !== ""
			? frontmatter.name.trim()
			: directoryName;
	if (name.length > MAX_NAME_LENGTH) {
		throw new Error(
			`Skill name must be at most ${MAX_NAME_LENGTH} characters.`,
		);
	}
	if (
		typeof frontmatter.description !== "string" ||
		frontmatter.description.trim() === ""
	) {
		throw new Error("Frontmatter field 'description' is required.");
	}

	const instructions = match[2].trim();
	if (instructions === "") {
		throw new Error("Skill body is empty.");
	}

	return {
		metadata: {
			name,
			description: frontmatter.description.trim(),
			...(typeof frontmatter.license === "string"
				? { license: frontmatter.license }
				: {}),
		},
		instructions,
		frontmatter,
	};
}
