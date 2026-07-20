import type {
	AgentMessage,
	AgentModel,
	AgentRunResult,
	AgentRuntimeEvent,
	AgentRuntimeStateSnapshot,
	AgentRuntimeConfig as BaseAgentRuntimeConfig,
} from "@coohu/shared";
export type AgentRunInput = string | AgentMessage | readonly AgentMessage[];
export type AgentEventListener = (event: AgentRuntimeEvent) => void;
/**
 * Advanced form: caller supplies a pre-built `AgentModel`. Used by
 * `@coohu/core`, which constructs models itself to share gateway/telemetry
 * wiring with the rest of the session runtime.
 */
export interface AgentRuntimeConfigWithModel extends BaseAgentRuntimeConfig {
	model: AgentModel;
}
/**
 * Friendly form: caller supplies provider/model IDs and credentials, and the
 * runtime builds an `AgentModel` internally via `@coohu/llms`. This is the
 * entry point most standalone users want.
 */
export interface AgentRuntimeConfigWithProvider
	extends Omit<BaseAgentRuntimeConfig, "model"> {
	/** Provider ID (e.g., "anthropic", "openai") */
	providerId: string;
	/** Model ID to use */
	modelId: string;
	/** API key for the provider */
	apiKey?: string;
	/** Custom base URL for the API */
	baseUrl?: string;
	/** Additional headers for API requests */
	headers?: Record<string, string>;
}
/**
 * Config accepted by `new AgentRuntime(...)` / `createAgentRuntime(...)` /
 * `new Agent(...)` / `createAgent(...)`. Either supply a pre-built `model`
 * (advanced) or `providerId` + `modelId` (+ credentials) and the runtime will
 * construct the model itself via `@coohu/llms`.
 */
export type AgentRuntimeConfig =
	| AgentRuntimeConfigWithModel
	| AgentRuntimeConfigWithProvider;
export declare class AgentRuntimeAbortError extends Error {
	readonly reason?: unknown;
	constructor(reason?: unknown);
}
export declare class AgentRuntime {
	private config;
	private readonly listeners;
	private readonly tools;
	private hooks;
	private readonly state;
	private initialization?;
	private abortController?;
	constructor(config: AgentRuntimeConfig);
	run(input: AgentRunInput): Promise<AgentRunResult>;
	continue(input?: AgentRunInput): Promise<AgentRunResult>;
	abort(reason?: unknown): void;
	subscribe(listener: AgentEventListener): () => void;
	/**
	 * Replace the conversation with a fresh set of messages, discarding any
	 * in-flight run and usage state while preserving the underlying model,
	 * tools, hooks, plugins, and active event subscribers.
	 *
	 * Useful for standalone callers that persist conversations externally and
	 * want to re-seed the runtime from storage without recreating subscribers.
	 */
	restore(messages: readonly AgentMessage[]): void;
	snapshot(): AgentRuntimeStateSnapshot;
	private ensureInitialized;
	private initialize;
	private registerHooks;
	private getRequiredCompletionToolNames;
	private getCompletionToolReminderMessage;
	private getCompletionReminderMessages;
	private addUserReminderMessage;
	private execute;
	private callBeforeRunHooks;
	private callAfterRunHooks;
	private generateAssistantMessage;
	private prepareTurnForModelRequest;
	private consumePendingUserMessage;
	private updateUsage;
	private executeToolCalls;
	private findCompletingToolMessage;
	private prepareToolExecution;
	private requestToolApproval;
	private executePreparedTool;
	private finishRun;
	private findLastAssistantMessage;
	private throwIfAborted;
	private normalizeAbortError;
	private emit;
	private applyStopControl;
}
export declare function createAgentRuntime(
	config: AgentRuntimeConfig,
): AgentRuntime;
/**
 * `Agent` is the user-friendly name for `AgentRuntime`. They are the same
 * class; this alias exists so standalone callers can write:
 *
 *     const agent = new Agent({ providerId, modelId, apiKey });
 *     await agent.run("hello");
 *
 * while `@coohu/core` (which owns model construction) continues to use
 * the `AgentRuntime` name with `{ model, ... }` configs.
 */
export declare const Agent: typeof AgentRuntime;
export type Agent = AgentRuntime;
export declare function createAgent(config: AgentRuntimeConfig): AgentRuntime;
