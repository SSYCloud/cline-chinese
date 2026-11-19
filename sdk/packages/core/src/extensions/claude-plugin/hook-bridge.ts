import type {
	AgentAfterToolResult,
	AgentBeforeToolResult,
	AgentHooks,
	AgentRunStartResult,
	AgentRuntimeStateSnapshot,
	BasicLogger,
} from "@cline/shared";
import { matchesClaudeHookMatcher } from "./hook-config";
import {
	type ClaudeHookJsonOutput,
	type ClaudeHookRunResult,
	runClaudeHookCommand,
} from "./hook-runner";
import {
	fromClaudeToolInput,
	matchableToolNames,
	toClaudeToolInput,
} from "./tool-names";
import type { ClaudeHookEventName, ClaudePluginHookBinding } from "./types";

export interface ClaudeHookBridgeOptions {
	bindings: ReadonlyArray<ClaudePluginHookBinding>;
	cwd: string;
	logger?: BasicLogger;
}

interface HookOutcome {
	binding: ClaudePluginHookBinding;
	result: ClaudeHookRunResult;
}

/**
 * Translate Claude Code plugin hooks into Cline's runtime hook bag.
 *
 * Mapping: PreToolUse -> beforeTool (deny/exit 2 skips the call, `updatedInput`
 * rewrites it), PostToolUse -> afterTool (block feeds its reason back to the
 * model), SessionStart/UserPromptSubmit -> beforeRun (context injection, and
 * UserPromptSubmit may stop the run), Stop -> afterRun. Stop is observational:
 * Cline's afterRun cannot reopen a finished run, so a blocking Stop decision has
 * no effect.
 *
 * Returns undefined when there are no executable bindings, so the extension
 * contributes no hooks capability at all.
 */
export function createClaudeHookBridge(
	options: ClaudeHookBridgeOptions,
): AgentHooks | undefined {
	const byEvent = groupByEvent(options.bindings);
	if (byEvent.size === 0) {
		return undefined;
	}
	const runner = new ClaudeHookRunner(options);
	const hooks: AgentHooks = {};

	if (byEvent.has("PreToolUse")) {
		hooks.beforeTool = async (context) => {
			const toolInput = toClaudeToolInput(context.tool.name, context.input);
			const outcomes = await runner.run(
				"PreToolUse",
				matchableToolNames(context.tool.name),
				{
					...basePayload(context.snapshot, options.cwd),
					hook_event_name: "PreToolUse",
					tool_name: matchableToolNames(context.tool.name)[0],
					tool_input: toolInput,
				},
			);
			return preToolDecision(context.tool.name, outcomes);
		};
	}

	if (byEvent.has("PostToolUse") || byEvent.has("PostToolUseFailure")) {
		hooks.afterTool = async (context) => {
			const failed = context.result.isError === true;
			const event: ClaudeHookEventName =
				failed && byEvent.has("PostToolUseFailure")
					? "PostToolUseFailure"
					: "PostToolUse";
			const outcomes = await runner.run(
				event,
				matchableToolNames(context.tool.name),
				{
					...basePayload(context.snapshot, options.cwd),
					hook_event_name: event,
					tool_name: matchableToolNames(context.tool.name)[0],
					tool_input: toClaudeToolInput(context.tool.name, context.input),
					tool_response: {
						output: context.result.output,
						isError: failed,
					},
				},
			);
			return postToolDecision(outcomes);
		};
	}

	if (byEvent.has("SessionStart") || byEvent.has("UserPromptSubmit")) {
		let sessionStarted = false;
		hooks.beforeRun = async ({ snapshot }) => {
			const contexts: string[] = [];
			if (!sessionStarted) {
				sessionStarted = true;
				const outcomes = await runner.run("SessionStart", undefined, {
					...basePayload(snapshot, options.cwd),
					hook_event_name: "SessionStart",
					source: "startup",
				});
				contexts.push(...collectContexts(outcomes));
			}
			const promptOutcomes = await runner.run("UserPromptSubmit", undefined, {
				...basePayload(snapshot, options.cwd),
				hook_event_name: "UserPromptSubmit",
				prompt: latestUserText(snapshot),
			});
			return runStartDecision(contexts, promptOutcomes);
		};
	}

	if (byEvent.has("Stop")) {
		hooks.afterRun = async ({ snapshot, result }) => {
			if (result.status !== "completed") {
				return;
			}
			await runner.run("Stop", undefined, {
				...basePayload(snapshot, options.cwd),
				hook_event_name: "Stop",
				stop_hook_active: false,
			});
		};
	}

	return hooks;
}

class ClaudeHookRunner {
	constructor(private readonly options: ClaudeHookBridgeOptions) {}

	async run(
		event: ClaudeHookEventName,
		candidateToolNames: ReadonlyArray<string> | undefined,
		input: Record<string, unknown>,
	): Promise<HookOutcome[]> {
		const outcomes: HookOutcome[] = [];
		for (const binding of this.options.bindings) {
			if (binding.event !== event) {
				continue;
			}
			if (
				candidateToolNames !== undefined &&
				!matchesClaudeHookMatcher(binding.matcher, candidateToolNames)
			) {
				continue;
			}
			outcomes.push({ binding, result: await this.execute(binding, input) });
		}
		return outcomes;
	}

	private async execute(
		binding: ClaudePluginHookBinding,
		input: Record<string, unknown>,
	): Promise<ClaudeHookRunResult> {
		let result: ClaudeHookRunResult;
		try {
			result = await runClaudeHookCommand({
				command: expandPluginRoot(binding.command, binding),
				cwd: this.options.cwd,
				env: {
					CLAUDE_PLUGIN_ROOT: binding.pluginRoot,
					CLAUDE_PLUGIN_DATA: binding.pluginDataPath,
					CLAUDE_PROJECT_DIR: this.options.cwd,
				},
				input,
				timeoutSeconds: binding.timeoutSeconds,
				dataDirectory: binding.pluginDataPath,
			});
		} catch (error) {
			result = {
				status: "error",
				message: error instanceof Error ? error.message : String(error),
			};
		}
		if (result.status === "error") {
			this.options.logger?.log(
				`[claude-plugins] ${binding.pluginName} ${binding.event} hook failed: ${result.message}`,
				{ severity: "warn" },
			);
		}
		return result;
	}
}

function preToolDecision(
	clineToolName: string,
	outcomes: ReadonlyArray<HookOutcome>,
): AgentBeforeToolResult | undefined {
	let denial: string | undefined;
	let stopReason: string | undefined;
	let updatedInput: Record<string, unknown> | undefined;
	const contexts: string[] = [];

	for (const { result } of outcomes) {
		if (result.status === "blocking") {
			denial ??= result.message;
			continue;
		}
		if (result.status !== "success" || !result.json) {
			continue;
		}
		const json = result.json;
		if (json.continue === false) {
			stopReason ??= json.stopReason ?? "Stopped by a Claude plugin hook.";
		}
		if (
			json.decision === "block" ||
			json.hookSpecificOutput?.permissionDecision === "deny"
		) {
			denial ??=
				json.reason ??
				json.hookSpecificOutput?.permissionDecisionReason ??
				"Blocked by a Claude plugin hook.";
		}
		if (json.hookSpecificOutput?.updatedInput) {
			updatedInput = json.hookSpecificOutput.updatedInput;
		}
		pushContext(contexts, json);
	}

	const appendContext = joinContexts(contexts);
	if (stopReason !== undefined) {
		return { stop: true, reason: stopReason, appendContext };
	}
	if (denial !== undefined) {
		return { skip: true, reason: denial, appendContext };
	}
	if (updatedInput === undefined && appendContext === undefined) {
		return undefined;
	}
	return {
		...(updatedInput !== undefined
			? { input: fromClaudeToolInput(clineToolName, updatedInput) }
			: {}),
		appendContext,
	};
}

function postToolDecision(
	outcomes: ReadonlyArray<HookOutcome>,
): AgentAfterToolResult | undefined {
	const contexts: string[] = [];
	for (const { result } of outcomes) {
		if (result.status === "blocking") {
			contexts.push(result.message);
		} else if (result.status === "success" && result.json) {
			if (result.json.decision === "block") {
				contexts.push(result.json.reason ?? "Flagged by a Claude plugin hook.");
			}
			pushContext(contexts, result.json);
		}
	}
	const appendContext = joinContexts(contexts);
	return appendContext === undefined ? undefined : { appendContext };
}

function runStartDecision(
	sessionContexts: ReadonlyArray<string>,
	promptOutcomes: ReadonlyArray<HookOutcome>,
): AgentRunStartResult | undefined {
	let reason: string | undefined;
	const contexts = [...sessionContexts];
	for (const { result } of promptOutcomes) {
		if (result.status === "blocking") {
			reason ??= result.message;
		} else if (result.status === "success" && result.json) {
			if (result.json.decision === "block") {
				reason ??=
					result.json.reason ?? "Prompt blocked by a Claude plugin hook.";
			}
			pushContext(contexts, result.json);
		}
	}
	if (reason !== undefined) {
		return { stop: true, reason };
	}
	const appendContext = joinContexts(contexts);
	return appendContext === undefined ? undefined : { appendContext };
}

function collectContexts(outcomes: ReadonlyArray<HookOutcome>): string[] {
	const contexts: string[] = [];
	for (const { result } of outcomes) {
		if (result.status === "success") {
			if (result.json) {
				pushContext(contexts, result.json);
			} else if (result.text) {
				contexts.push(result.text);
			}
		}
	}
	return contexts;
}

function pushContext(contexts: string[], json: ClaudeHookJsonOutput): void {
	const additional = json.hookSpecificOutput?.additionalContext;
	if (additional) {
		contexts.push(additional);
	}
}

function joinContexts(contexts: ReadonlyArray<string>): string | undefined {
	const joined = contexts.filter((entry) => entry.length > 0).join("\n\n");
	return joined.length > 0 ? joined : undefined;
}

function latestUserText(snapshot: AgentRuntimeStateSnapshot): string {
	for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
		const message = snapshot.messages[index];
		if (message.role !== "user") {
			continue;
		}
		return message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

function basePayload(
	snapshot: AgentRuntimeStateSnapshot,
	cwd: string,
): Record<string, unknown> {
	return {
		session_id: snapshot.conversationId ?? snapshot.agentId,
		cwd,
	};
}

function groupByEvent(
	bindings: ReadonlyArray<ClaudePluginHookBinding>,
): Map<ClaudeHookEventName, ClaudePluginHookBinding[]> {
	const grouped = new Map<ClaudeHookEventName, ClaudePluginHookBinding[]>();
	for (const binding of bindings) {
		const list = grouped.get(binding.event) ?? [];
		list.push(binding);
		grouped.set(binding.event, list);
	}
	return grouped;
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code defines this literal placeholder.
const CLAUDE_PLUGIN_ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}";

function expandPluginRoot(
	command: string,
	binding: ClaudePluginHookBinding,
): string {
	return command
		.split(CLAUDE_PLUGIN_ROOT_TOKEN)
		.join(shellQuote(binding.pluginRoot));
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}
