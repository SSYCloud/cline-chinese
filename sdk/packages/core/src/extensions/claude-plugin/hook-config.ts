import type { ClaudeHookEventName, ClaudePluginHookBinding } from "./types";

export const CLAUDE_HOOK_EVENT_NAMES: ReadonlySet<string> =
	new Set<ClaudeHookEventName>([
		"PreToolUse",
		"PostToolUse",
		"UserPromptSubmit",
		"SessionStart",
		"Stop",
		"SubagentStop",
		"PreCompact",
		"Notification",
		"SessionEnd",
		"PostToolUseFailure",
	]);

const EXECUTABLE_CLAUDE_HOOK_EVENTS: ReadonlySet<ClaudeHookEventName> = new Set(
	[
		"PreToolUse",
		"PostToolUse",
		"PostToolUseFailure",
		"UserPromptSubmit",
		"SessionStart",
		"Stop",
	],
);

const MATCHER_EVENTS: ReadonlySet<ClaudeHookEventName> = new Set([
	"PreToolUse",
	"PostToolUse",
	"PostToolUseFailure",
]);

const DEFAULT_HOOK_TIMEOUT_SECONDS = 60;

export type ClaudeHookBindingDraft = Omit<
	ClaudePluginHookBinding,
	"pluginName" | "pluginRoot" | "pluginDataPath"
>;

export interface ParsedClaudeHooksDocument {
	bindings: ClaudeHookBindingDraft[];
	/** Function-hook module paths from `modules`, relative to the plugin root. */
	modules: string[];
	problems: string[];
}

/**
 * Parse a Claude Code `hooks.json` document. Problems are collected rather than
 * thrown so one bad entry does not disable the plugin's other hooks.
 */
export function parseClaudeHooksDocument(
	document: unknown,
): ParsedClaudeHooksDocument {
	const bindings: ClaudeHookBindingDraft[] = [];
	const modules: string[] = [];
	const problems: string[] = [];
	const hooksByEvent =
		isRecord(document) && isRecord(document.hooks) ? document.hooks : undefined;
	if (isRecord(document) && Array.isArray(document.modules)) {
		for (const entry of document.modules) {
			if (typeof entry === "string" && entry.trim() !== "") {
				modules.push(entry);
			} else {
				problems.push(
					"hooks.json 'modules' entries must be non-empty strings.",
				);
			}
		}
		if (!hooksByEvent) {
			return { bindings, modules, problems };
		}
	} else if (!hooksByEvent) {
		problems.push("hooks document must contain a 'hooks' object.");
		return { bindings, modules, problems };
	}

	for (const [event, groups] of Object.entries(hooksByEvent)) {
		if (!CLAUDE_HOOK_EVENT_NAMES.has(event)) {
			problems.push(`Unknown hook event '${event}' is ignored.`);
			continue;
		}
		if (!EXECUTABLE_CLAUDE_HOOK_EVENTS.has(event as ClaudeHookEventName)) {
			problems.push(
				`Hook event '${event}' is not supported by Cline and is ignored.`,
			);
			continue;
		}
		if (!Array.isArray(groups)) {
			problems.push(
				`Hook event '${event}' must be an array of matcher groups.`,
			);
			continue;
		}
		const hookEvent = event as ClaudeHookEventName;
		for (const group of groups) {
			parseMatcherGroup(hookEvent, group, bindings, problems);
		}
	}
	return { bindings, modules, problems };
}

function parseMatcherGroup(
	event: ClaudeHookEventName,
	group: unknown,
	bindings: ClaudeHookBindingDraft[],
	problems: string[],
): void {
	if (!isRecord(group) || !Array.isArray(group.hooks)) {
		problems.push(`${event} matcher group must contain a 'hooks' array.`);
		return;
	}
	let matcher: string | undefined;
	if (group.matcher !== undefined) {
		if (typeof group.matcher !== "string") {
			problems.push(`${event} matcher must be a string.`);
			return;
		}
		matcher = group.matcher;
	}
	if (matcher !== undefined && !MATCHER_EVENTS.has(event)) {
		problems.push(
			`${event} does not support matchers; the matcher is ignored.`,
		);
		matcher = undefined;
	}
	if (
		matcher !== undefined &&
		!isWildcardMatcher(matcher) &&
		!isValidMatcher(matcher)
	) {
		problems.push(
			`${event} matcher '${matcher}' is not a valid regular expression.`,
		);
		return;
	}

	for (const handler of group.hooks) {
		const parsed = parseHandler(event, handler);
		if (typeof parsed === "string") {
			problems.push(parsed);
			continue;
		}
		bindings.push({
			event,
			...(matcher !== undefined && matcher !== "" && matcher !== "*"
				? { matcher }
				: {}),
			command: parsed.command,
			timeoutSeconds: parsed.timeoutSeconds,
		});
	}
}

function parseHandler(
	event: ClaudeHookEventName,
	handler: unknown,
): { command: string; timeoutSeconds: number } | string {
	if (!isRecord(handler) || handler.type !== "command") {
		return `${event} hook handler must have type 'command'; other handler types are ignored.`;
	}
	if (typeof handler.command !== "string" || handler.command.trim() === "") {
		return `${event} hook handler requires a non-empty 'command'.`;
	}
	let timeoutSeconds = DEFAULT_HOOK_TIMEOUT_SECONDS;
	if (handler.timeout !== undefined) {
		if (
			typeof handler.timeout !== "number" ||
			!Number.isFinite(handler.timeout) ||
			handler.timeout <= 0
		) {
			return `${event} hook 'timeout' must be a positive number of seconds.`;
		}
		timeoutSeconds = handler.timeout;
	}
	return { command: handler.command, timeoutSeconds };
}

/**
 * Claude matchers are an empty/`*` wildcard or a regular expression matched
 * against the whole tool name. Non-wildcard matchers are anchored so `Edit`
 * does not also fire for `MultiEdit`.
 */
export function matchesClaudeHookMatcher(
	matcher: string | undefined,
	candidateNames: ReadonlyArray<string>,
): boolean {
	if (matcher === undefined || isWildcardMatcher(matcher)) {
		return true;
	}
	const pattern = anchoredMatcher(matcher);
	return candidateNames.some((name) => pattern.test(name));
}

function anchoredMatcher(matcher: string): RegExp {
	return new RegExp(`^(?:${matcher})$`);
}

function isWildcardMatcher(matcher: string): boolean {
	return matcher === "" || matcher === "*";
}

function isValidMatcher(matcher: string): boolean {
	try {
		anchoredMatcher(matcher);
		return true;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
