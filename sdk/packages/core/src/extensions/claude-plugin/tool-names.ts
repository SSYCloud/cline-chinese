import { normalizeRunCommandsInput } from "../tools/helpers";

const CLINE_TO_CLAUDE_TOOL_NAMES: Readonly<Record<string, string>> = {
	run_commands: "Bash",
	read_files: "Read",
	editor: "Edit",
	search_codebase: "Grep",
	fetch_web_content: "WebFetch",
	web_search: "WebSearch",
	ask_question: "AskUserQuestion",
	skills: "Skill",
};

/**
 * Names a Claude hook matcher is tested against for one Cline tool. The Claude
 * alias comes first so `Bash` matches `run_commands`, and the native name stays
 * matchable for plugins that were written against Cline tool names.
 */
export function matchableToolNames(clineToolName: string): string[] {
	const claudeName = CLINE_TO_CLAUDE_TOOL_NAMES[clineToolName];
	return claudeName ? [claudeName, clineToolName] : [clineToolName];
}

/**
 * Claude hooks read `tool_input.command` for Bash, while Cline carries one or
 * more commands. Other tools pass through unchanged.
 */
export function toClaudeToolInput(
	clineToolName: string,
	input: unknown,
): unknown {
	if (clineToolName === "editor" || clineToolName === "read_files") {
		return withFilePathAlias(input);
	}
	if (clineToolName !== "run_commands") {
		return input;
	}
	try {
		const commands = normalizeRunCommandsInput(input);
		return {
			command: commands
				.map((command) =>
					typeof command === "string" ? command : JSON.stringify(command),
				)
				.join("\n"),
		};
	} catch {
		return input;
	}
}

/**
 * Inverse of {@link toClaudeToolInput} for `updatedInput` returned by a hook.
 * Only Bash has a structural difference that needs translating back.
 */
export function fromClaudeToolInput(
	clineToolName: string,
	updatedInput: Record<string, unknown>,
): unknown {
	if (
		clineToolName === "run_commands" &&
		typeof updatedInput.command === "string"
	) {
		return { commands: [updatedInput.command] };
	}
	return updatedInput;
}

/**
 * Claude's file tools name the target `file_path`, while Cline's use `path`.
 * Plugin hooks read `tool_input.file_path`, so the Claude-facing view carries
 * both names and the original fields are kept untouched.
 */
function withFilePathAlias(input: unknown): unknown {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return input;
	}
	const record = input as Record<string, unknown>;
	return typeof record.path === "string" && record.file_path === undefined
		? { ...record, file_path: record.path }
		: input;
}
