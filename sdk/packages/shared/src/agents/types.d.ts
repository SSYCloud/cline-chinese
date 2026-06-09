/**
 * Agent Types and Zod Schemas
 *
 * Canonical type definitions for agent configuration, events, hooks,
 * extensions, and results.
 *
 * ProviderConfig is left as `unknown` here so that shared stays
 * dependency-free of @coohu/llms. Consuming packages narrow it
 * via re-exports. ModelInfo lives in shared (../llms/model-info)
 * and is used directly.
 */
import { z } from "zod";
import type { AgentRuntimeHooks, AgentTool } from "../agent";
import type { ExtensionContext } from "../extensions/context";
import type { AgentExtensionApi, AgentExtensionHooks, AgentExtensionRegistry as AgentExtensionRegistryGeneric, ContributionRegistryExtension, PluginManifest, PluginSetupContext } from "../extensions/contribution-registry";
import type { HookControl } from "../hooks/contracts";
import type { Message, MessageWithMetadata } from "../llms/messages";
import type { ModelInfo } from "../llms/model-info";
import type { ToolApprovalRequest, ToolApprovalResult, ToolCallRecord, ToolPolicy } from "../llms/tools";
import type { BasicLogger } from "../logging/logger";
import type { ITelemetryService } from "../services/telemetry";
import type { WorkspaceInfo } from "../session/workspace";
/**
 * Events emitted during agent execution
 */
export type AgentEvent = AgentContentStartEvent | AgentContentUpdateEvent | AgentContentEndEvent | AgentIterationStartEvent | AgentIterationEndEvent | AgentNoticeEvent | AgentUsageEvent | AgentDoneEvent | AgentErrorEvent;
export type AgentContentType = "text" | "reasoning" | "tool";
export interface AgentEventMetadata {
    /** Current ID */
    agentId?: string;
    /** Task ID */
    conversationId?: string;
    /** ID of the agent that created this agent */
    parentAgentId?: string | null;
}
export interface AgentContentStartEvent extends AgentEventMetadata {
    type: "content_start";
    contentType: AgentContentType;
    /** The text chunk received from the model */
    text?: string;
    /** Accumulated text so far in this turn */
    accumulated?: string;
    /** The reasoning/thinking text from the model */
    reasoning?: string;
    /** Whether this is redacted reasoning */
    redacted?: boolean;
    /** Name of the tool being called */
    toolName?: string;
    /** Unique identifier for this tool call */
    toolCallId?: string;
    /** Input being passed to the tool */
    input?: unknown;
}
export interface AgentContentUpdateEvent extends AgentEventMetadata {
    type: "content_update";
    contentType: "tool";
    /** Name of the tool emitting progress */
    toolName?: string;
    /** Unique identifier for this tool call */
    toolCallId?: string;
    /** Partial result emitted by the tool */
    update: unknown;
}
export interface AgentContentEndEvent extends AgentEventMetadata {
    type: "content_end";
    contentType: AgentContentType;
    /** Final text generated for this turn */
    text?: string;
    /** Final reasoning/thinking text generated for this turn */
    reasoning?: string;
    /** Name of the tool that completed */
    toolName?: string;
    /** Unique identifier for this tool call */
    toolCallId?: string;
    /** Output from the tool */
    output?: unknown;
    /** Error message if the tool failed */
    error?: string;
    /** Time taken in milliseconds for tool content */
    durationMs?: number;
}
export interface AgentIterationStartEvent extends AgentEventMetadata {
    type: "iteration_start";
    /** The iteration number (1-based) */
    iteration: number;
}
export interface AgentIterationEndEvent extends AgentEventMetadata {
    type: "iteration_end";
    /** The iteration number that just completed */
    iteration: number;
    /** Whether this iteration had any tool calls */
    hadToolCalls: boolean;
    /** Number of tool calls in this iteration */
    toolCallCount: number;
}
export interface AgentUsageEvent extends AgentEventMetadata {
    type: "usage";
    /** Number of input tokens for this turn */
    inputTokens: number;
    /** Number of output tokens for this turn */
    outputTokens: number;
    /** Tokens read from cache */
    cacheReadTokens?: number;
    /** Tokens written to cache */
    cacheWriteTokens?: number;
    /** Cost for this turn */
    cost?: number;
    /** Accumulated totals */
    totalInputTokens: number;
    totalCacheReadTokens?: number;
    totalCacheWriteTokens?: number;
    totalOutputTokens: number;
    totalCost?: number;
}
export interface AgentNoticeEvent extends AgentEventMetadata {
    type: "notice";
    noticeType: "recovery" | "stop" | "status";
    message: string;
    displayRole?: "system" | "status";
    reason?: "api_error" | "invalid_tool_call" | "completion_without_submit" | "tool_execution_failed" | "mistake_limit" | "auto_compaction";
    metadata?: Record<string, unknown>;
}
export interface AgentDoneEvent extends AgentEventMetadata {
    type: "done";
    /** The reason the agent stopped */
    reason: AgentFinishReason;
    /** Final text output */
    text: string;
    /** Total number of iterations */
    iterations: number;
    /** Aggregated usage information */
    usage?: LegacyAgentUsage;
}
export interface AgentErrorEvent extends AgentEventMetadata {
    type: "error";
    /** The error that occurred */
    error: Error;
    /** Whether the error is recoverable */
    recoverable: boolean;
    /** Current iteration when error occurred */
    iteration: number;
}
export interface ConsecutiveMistakeLimitContext {
    iteration: number;
    consecutiveMistakes: number;
    maxConsecutiveMistakes: number;
    reason: "api_error" | "invalid_tool_call" | "tool_execution_failed";
    details?: string;
}
export type ConsecutiveMistakeLimitDecision = {
    action: "continue";
    /**
     * Optional guidance appended as a user message before continuing.
     */
    guidance?: string;
} | {
    action: "stop";
    /**
     * Optional reason surfaced when stopping due to the limit.
     */
    reason?: string;
};
export interface LoopDetectionConfig {
    softThreshold: number;
    hardThreshold: number;
}
export interface AgentExecutionConfig {
    /**
     * Maximum consecutive internal mistakes before escalation.
     * Mistakes include API turn failures, invalid/missing tool-call arguments,
     * and iterations where every executed tool call fails.
     * @default 6
     */
    maxConsecutiveMistakes?: number;
    /**
     * After this many consecutive iterations with tool calls,
     * inject a reminder text block asking the agent to answer if it has enough info.
     * Set to `0` or omit to disable.
     * @default 0
     */
    reminderAfterIterations?: number;
    /**
     * Custom reminder text to inject after `reminderAfterIterations`.
     * @default "REMINDER: If you have gathered enough information to answer the user's question, please provide your final answer now without using any more tools."
     */
    reminderText?: string;
    /**
     * Repeated tool call loop detection. When enabled, the agent detects
     * consecutive identical tool calls and intervenes:
     * - At `softThreshold`: injects a recovery notice urging a different approach.
     * - At `hardThreshold`: triggers the consecutive-mistake-limit decision path.
     *
     * Set to `false` to explicitly disable. Omit or leave `undefined` for no detection.
     * The CLI enables this by default with `{ softThreshold: 3, hardThreshold: 5 }`.
     */
    loopDetection?: false | Partial<LoopDetectionConfig>;
}
/**
 * Hook error handling behavior.
 * - "ignore": swallow hook errors and continue agent execution
 * - "throw": fail agent execution when a hook throws
 */
export type HookErrorMode = "ignore" | "throw";
/**
 * Common controls supported by lifecycle hooks.
 */
export type AgentHookControl = Omit<HookControl, "appendMessages"> & {
    /**
     * Optional messages appended to history.
     * Primarily used by before-agent-start hook stages.
     */
    appendMessages?: Message[];
    /**
     * Optional replacement message history.
     * Primarily used by before-agent-start hooks and host-owned context pipelines.
     */
    replaceMessages?: Message[];
};
export interface AgentHookRunStartContext {
    /**
     * ID of the agent
     */
    agentId: string;
    /**
     * Session ID
     */
    conversationId: string;
    /**
     * ID of the agent that spawned the agent that is executing this run
     */
    parentAgentId: string | null;
    /**
     * The prompt submitted by user
     */
    userMessage: string;
}
export interface AgentHookScheduleContext {
    scheduleId: string;
    executionId?: string;
    trigger: "scheduled" | "manual";
    triggeredAt?: string;
}
/**
 * Workspace location fields shared by session-scoped and run-scoped contexts.
 *
 * These fields are always sourced from the host session config — never from
 * `process.cwd()`. Plugins and hooks must use these values when they need to
 * resolve paths relative to the session's working directory or project root,
 * because the `--cwd` CLI flag sets the session cwd without calling
 * `process.chdir()`, so `process.cwd()` may return the wrong path.
 */
export interface SessionWorkspaceEnv {
    /**
     * The session's active working directory as configured by the host (e.g.
     * via `--cwd`). Always accurate — never use `process.cwd()` in plugins or
     * hooks; use this field instead.
     */
    cwd?: string;
    /**
     * The workspace / project root when it differs from `cwd`. Global plugins
     * installed outside the project should use this rather than
     * `import.meta.url` tricks or `process.cwd()`.
     */
    workspaceRoot?: string;
    /**
     * Structured workspace and git metadata for the session.
     *
     * Contains the same information as the `{{CLINE_METADATA}}` block in the
     * system prompt but in structured form: `rootPath`, `hint`,
     * `associatedRemoteUrls`, `latestGitCommitHash`, `latestGitBranchName`.
     *
     * Plugins and hooks can use this for branch-aware logic, commit
     * attribution, or tooling integrations without running their own `git`
     * calls. Populated once per session at session-start time.
     */
    workspaceInfo?: WorkspaceInfo;
}
/**
 * Fired exactly once for the lifetime of an agent conversation, before the
 * first run starts. This is the right place for session-scoped setup.
 */
export interface AgentHookSessionStartContext extends SessionWorkspaceEnv {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    schedule?: AgentHookScheduleContext;
}
/**
 * Fired once per `run()` / `continue()` invocation after user input has been
 * accepted and before the loop enters its first iteration.
 */
export interface AgentHookRunEndContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    result: AgentResult;
}
/**
 * Fired at the top of every loop iteration, before any turn-level prompt or
 * model preparation occurs.
 */
export interface AgentHookIterationStartContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
}
export interface AgentHookIterationEndContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    hadToolCalls: boolean;
    toolCallCount: number;
}
export interface AgentHookTurnStartContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    messages: Message[];
}
/**
 * Fired immediately before the model call for an iteration.
 *
 * Compared with `onIterationStart`, this hook runs later: after turn-start
 * processing and with the exact message list that will be sent to the model.
 * It can still influence the upcoming turn by replacing the system prompt,
 * appending messages, or cancelling the run.
 */
export interface AgentHookBeforeAgentStartContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    systemPrompt: string;
    messages: Message[];
}
export interface AgentHookTurnEndContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    turn: ProcessedTurn;
}
export interface AgentHookToolCallStartContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    call: PendingToolCall;
}
export interface AgentHookToolCallEndContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    record: ToolCallRecord;
}
export interface AgentHookErrorContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    error: Error;
}
export interface AgentHookStopErrorContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    error: Error;
}
export interface AgentHookSessionShutdownContext {
    agentId: string;
    conversationId: string;
    /** Stable core session id for the root session, when provided by the host. */
    sessionId?: string;
    parentAgentId: string | null;
    /**
     * Optional reason for shutdown (e.g. "ctrl_d", "process_exit")
     */
    reason?: string;
}
export interface AgentExtensionRuntimeEventContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    event: AgentEvent;
}
export interface AgentExtensionSessionStartContext extends SessionWorkspaceEnv {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    schedule?: AgentHookScheduleContext;
}
export interface AgentExtensionSessionShutdownContext {
    agentId: string;
    conversationId: string;
    /** Stable core session id for the root session, when provided by the host. */
    sessionId?: string;
    parentAgentId: string | null;
    reason?: string;
}
export interface AgentExtensionContext extends PluginSetupContext {
}
export interface AgentExtension extends ContributionRegistryExtension<AgentTool, Message[]> {
    name: string;
    manifest: PluginManifest;
    hooks?: AgentExtensionHooks;
    setup?: (api: AgentExtensionApi<AgentTool, Message[]>, ctx: AgentExtensionContext) => void | Promise<void>;
}
export type AgentLoopExtensionRegistry = AgentExtensionRegistryGeneric<AgentTool, Message>;
/**
 * Lifecycle hooks for observing or influencing agent execution.
 */
export type AgentHooks = Partial<AgentRuntimeHooks>;
/**
 * Reasons why the agent stopped executing
 */
export type AgentFinishReason = "completed" | "max_iterations" | "aborted" | "mistake_limit" | "error";
export declare const AgentFinishReasonSchema: z.ZodEnum<{
    error: "error";
    completed: "completed";
    aborted: "aborted";
    mistake_limit: "mistake_limit";
    max_iterations: "max_iterations";
}>;
/**
 * Aggregated token usage and cost information (legacy, host-facing shape).
 *
 * Renamed from `AgentUsage` to make room for the runtime's stricter
 * `AgentUsage` (see `../agent.ts`). Retained because
 * the host-facing `AgentResult`/`AgentUsageEvent` surface and the
 * `AgentUsageSchema` Zod schema use this more-permissive shape (all
 * cache/cost fields optional). The facade adapter converts between the
 * two shapes at runtime.
 */
export interface LegacyAgentUsage {
    /** Total input tokens across all iterations */
    inputTokens: number;
    /** Total output tokens across all iterations */
    outputTokens: number;
    /** Total tokens read from cache */
    cacheReadTokens?: number;
    /** Total tokens written to cache */
    cacheWriteTokens?: number;
    /** Total cost in dollars */
    totalCost?: number;
}
export declare const AgentUsageSchema: z.ZodObject<{
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    cacheReadTokens: z.ZodOptional<z.ZodNumber>;
    cacheWriteTokens: z.ZodOptional<z.ZodNumber>;
    totalCost: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export interface AgentPrepareTurnContext {
    agentId: string;
    conversationId: string;
    parentAgentId: string | null;
    iteration: number;
    messages: MessageWithMetadata[];
    apiMessages: MessageWithMetadata[];
    abortSignal: AbortSignal;
    systemPrompt: string;
    tools: AgentTool[];
    model: {
        id: string;
        provider: string;
        info?: ModelInfo;
    };
    emitStatusNotice?: (message: string, metadata?: Record<string, unknown>) => void;
}
export interface AgentPrepareTurnResult {
    messages?: MessageWithMetadata[];
    systemPrompt?: string;
}
/**
 * Result returned from Agent.run()
 */
export interface AgentResult {
    /** Final text output from the agent */
    text: string;
    /** Aggregated token usage and cost */
    usage: LegacyAgentUsage;
    /** Full conversation history */
    messages: MessageWithMetadata[];
    /** All tool calls made during execution */
    toolCalls: ToolCallRecord[];
    /** Number of loop iterations */
    iterations: number;
    /** Why the agent stopped */
    finishReason: AgentFinishReason;
    /** Model information used */
    model: {
        id: string;
        provider: string;
        info?: ModelInfo;
    };
    /** Start time of the run */
    startedAt: Date;
    /** End time of the run */
    endedAt: Date;
    /** Total duration in milliseconds */
    durationMs: number;
}
export declare const AgentResultSchema: z.ZodObject<{
    text: z.ZodString;
    usage: z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        cacheReadTokens: z.ZodOptional<z.ZodNumber>;
        cacheWriteTokens: z.ZodOptional<z.ZodNumber>;
        totalCost: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    messages: z.ZodArray<z.ZodCustom<MessageWithMetadata, MessageWithMetadata>>;
    toolCalls: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        input: z.ZodUnknown;
        output: z.ZodUnknown;
        error: z.ZodOptional<z.ZodString>;
        durationMs: z.ZodNumber;
        startedAt: z.ZodDate;
        endedAt: z.ZodDate;
    }, z.core.$strip>>;
    iterations: z.ZodNumber;
    finishReason: z.ZodEnum<{
        error: "error";
        completed: "completed";
        aborted: "aborted";
        mistake_limit: "mistake_limit";
        max_iterations: "max_iterations";
    }>;
    model: z.ZodObject<{
        id: z.ZodString;
        provider: z.ZodString;
        info: z.ZodOptional<z.ZodObject<{
            id: z.ZodString;
            name: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            maxTokens: z.ZodOptional<z.ZodNumber>;
            contextWindow: z.ZodOptional<z.ZodNumber>;
            maxInputTokens: z.ZodOptional<z.ZodNumber>;
            capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
                images: "images";
                tools: "tools";
                streaming: "streaming";
                "prompt-cache": "prompt-cache";
                reasoning: "reasoning";
                "reasoning-effort": "reasoning-effort";
                "computer-use": "computer-use";
                "global-endpoint": "global-endpoint";
                structured_output: "structured_output";
                temperature: "temperature";
                files: "files";
            }>>>;
            apiFormat: z.ZodOptional<z.ZodEnum<{
                default: "default";
                "openai-responses": "openai-responses";
                r1: "r1";
            }>>;
            systemRole: z.ZodOptional<z.ZodEnum<{
                system: "system";
                developer: "developer";
            }>>;
            temperature: z.ZodOptional<z.ZodNumber>;
            pricing: z.ZodOptional<z.ZodObject<{
                input: z.ZodOptional<z.ZodNumber>;
                output: z.ZodOptional<z.ZodNumber>;
                cacheWrite: z.ZodOptional<z.ZodNumber>;
                cacheRead: z.ZodOptional<z.ZodNumber>;
            }, z.core.$strip>>;
            thinkingConfig: z.ZodOptional<z.ZodObject<{
                maxBudget: z.ZodOptional<z.ZodNumber>;
                outputPrice: z.ZodOptional<z.ZodNumber>;
                thinkingLevel: z.ZodOptional<z.ZodEnum<{
                    low: "low";
                    high: "high";
                }>>;
            }, z.core.$strip>>;
            status: z.ZodOptional<z.ZodEnum<{
                active: "active";
                preview: "preview";
                deprecated: "deprecated";
                legacy: "legacy";
            }>>;
            deprecationNotice: z.ZodOptional<z.ZodString>;
            replacedBy: z.ZodOptional<z.ZodString>;
            releaseDate: z.ZodOptional<z.ZodString>;
            deprecationDate: z.ZodOptional<z.ZodString>;
            family: z.ZodOptional<z.ZodString>;
            metadata: z.ZodOptional<z.ZodObject<{
                reasoningDefaultOn: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$catchall<z.ZodUnknown>>>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    startedAt: z.ZodDate;
    endedAt: z.ZodDate;
    durationMs: z.ZodNumber;
}, z.core.$strip>;
/**
 * Reasoning effort level for capable models
 */
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export declare const ReasoningEffortSchema: z.ZodEnum<{
    low: "low";
    high: "high";
    medium: "medium";
    xhigh: "xhigh";
}>;
/**
 * Configuration for creating an Agent
 */
export interface AgentConfig {
    /**
     * Core/hub runtime session identifier.
     *
     * The host-owned lifecycle id for this task/session. Core uses it for
     * persistence, event routing, abort/stop operations, and approval delivery.
     * This is intentionally separate from `conversationId`, which identifies the
     * model transcript managed by the agent runtime.
     */
    sessionId?: string;
    /** Provider ID (e.g., "anthropic", "openai", "gemini") */
    providerId: string;
    /** Model ID to use */
    modelId: string;
    /** API key for the provider */
    apiKey?: string;
    /** Custom base URL for the API */
    baseUrl?: string;
    /** Additional headers for API requests */
    headers?: Record<string, string>;
    /** Optional provider model catalog overrides */
    knownModels?: Record<string, ModelInfo>;
    /** Optional pre-resolved provider configuration (includes provider-specific fields like aws/gcp). */
    providerConfig?: unknown;
    /**
     * Optional preloaded conversation history for resume flows.
     * When provided, start by calling continue() to preserve history.
     */
    initialMessages?: Message[];
    /** System prompt for the agent */
    systemPrompt: string;
    /** Tools available to the agent */
    tools: AgentTool[];
    /**
     * Maximum number of loop iterations
     * If undefined, no iteration cap is enforced.
     */
    maxIterations?: number;
    /**
     * Maximum number of tool calls to execute concurrently in a single iteration.
     * @default 8
     */
    maxParallelToolCalls?: number;
    /**
     * Maximum output tokens per API call
     */
    maxTokensPerTurn?: number;
    /**
     * Timeout for each API call in milliseconds
     * @default 180000 (3 minutes)
     */
    apiTimeoutMs?: number;
    /**
     * Optional runtime file-content loader used when user files are attached.
     * When omitted, attached files will be represented as loader errors.
     */
    userFileContentLoader?: (path: string) => Promise<string>;
    /**
     * Optional metadata merged into every tool execution context.
     * Hosts can use this to thread runtime-specific identifiers such as session IDs.
     */
    toolContextMetadata?: Record<string, unknown>;
    /** Execution guardrails and recovery settings. */
    execution?: AgentExecutionConfig;
    /**
     * Reasoning effort level
     */
    reasoningEffort?: ReasoningEffort;
    /**
     * Maximum tokens for thinking/reasoning
     */
    thinkingBudgetTokens?: number;
    /**
     * Enable default thinking/reasoning behavior for supported models.
     */
    thinking?: boolean;
    /**
     * Callback for agent events (streaming, progress, etc.)
     */
    onEvent?: (event: AgentEvent) => void;
    /**
     * Lifecycle hooks for observing or influencing agent execution.
     */
    hooks?: AgentHooks;
    /**
     * Optional parent agent ID for spawned/delegated runs.
     * Root agents should leave this undefined.
     */
    parentAgentId?: string;
    /**
     * Extension modules that can intercept lifecycle events and register tools/commands.
     */
    extensions?: AgentExtension[];
    /**
     * How hook errors should be handled.
     * @default "ignore"
     */
    hookErrorMode?: HookErrorMode;
    /**
     * Optional schedule metadata for runs initiated by scheduler services.
     * Used by session_start lifecycle hooks.
     */
    schedule?: AgentHookScheduleContext;
    /**
     * Per-tool execution policy. Tool names not listed here default to enabled + autoApprove.
     */
    toolPolicies?: Record<string, ToolPolicy>;
    /**
     * Optional callback to request client approval when a tool policy disables auto-approval.
     */
    requestToolApproval?: (request: ToolApprovalRequest) => Promise<ToolApprovalResult> | ToolApprovalResult;
    /**
     * Optional callback invoked when consecutive mistakes reach maxConsecutiveMistakes.
     */
    onConsecutiveMistakeLimitReached?: (context: ConsecutiveMistakeLimitContext) => Promise<ConsecutiveMistakeLimitDecision> | ConsecutiveMistakeLimitDecision;
    /**
     * Optional logger for tracing agent loop lifecycle and recoverable failures.
     */
    logger?: BasicLogger;
    /**
     * Optional callback that can rewrite the turn input before each model call.
     * This is the primary seam for host-owned context pipelines.
     */
    prepareTurn?: (context: AgentPrepareTurnContext) => Promise<AgentPrepareTurnResult | undefined> | AgentPrepareTurnResult | undefined;
    /**
     * Optional Telemetry service for emitting structured events about agent execution to configured telemetry backends.
     */
    telemetry?: ITelemetryService;
    /**
     * Ambient runtime context: user identity, client surface, workspace, logger,
     * and telemetry. Threaded through to ProviderConfig so handlers can access it.
     */
    extensionContext?: ExtensionContext;
    /**
     * First-class runtime completion policy. Tool-based completion is resolved
     * from the final agent tool list, so built-in and plugin tools can opt in
     * with `lifecycle.completesRun`.
     *
     * `completionGuard` runs when the model returns no tool calls.
     * If it returns a non-empty string, that string is injected as a
     * system-level nudge and the loop continues instead of completing.
     * Use this to prevent premature exit when the agent has unfinished
     * obligations (e.g. in-progress team tasks).
     */
    completionPolicy?: {
        requireCompletionTool?: boolean;
        completionGuard?: () => string | undefined;
    };
    /**
     * Optional callback invoked at the top of each agent loop iteration
     * (after the first). If it returns a non-empty string, that string is
     * injected as a user message into the conversation before the next API
     * call. This allows the host to feed user input into a running loop
     * without waiting for the current run to finish.
     */
    consumePendingUserMessage?: () => string | undefined;
    /**
     * Abort signal for cancellation
     */
    abortSignal?: AbortSignal;
}
export declare const AgentConfigSchema: z.ZodObject<{
    sessionId: z.ZodOptional<z.ZodString>;
    providerId: z.ZodString;
    modelId: z.ZodString;
    apiKey: z.ZodOptional<z.ZodString>;
    baseUrl: z.ZodOptional<z.ZodString>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    knownModels: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        id: z.ZodString;
        name: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        maxTokens: z.ZodOptional<z.ZodNumber>;
        contextWindow: z.ZodOptional<z.ZodNumber>;
        maxInputTokens: z.ZodOptional<z.ZodNumber>;
        capabilities: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            images: "images";
            tools: "tools";
            streaming: "streaming";
            "prompt-cache": "prompt-cache";
            reasoning: "reasoning";
            "reasoning-effort": "reasoning-effort";
            "computer-use": "computer-use";
            "global-endpoint": "global-endpoint";
            structured_output: "structured_output";
            temperature: "temperature";
            files: "files";
        }>>>;
        apiFormat: z.ZodOptional<z.ZodEnum<{
            default: "default";
            "openai-responses": "openai-responses";
            r1: "r1";
        }>>;
        systemRole: z.ZodOptional<z.ZodEnum<{
            system: "system";
            developer: "developer";
        }>>;
        temperature: z.ZodOptional<z.ZodNumber>;
        pricing: z.ZodOptional<z.ZodObject<{
            input: z.ZodOptional<z.ZodNumber>;
            output: z.ZodOptional<z.ZodNumber>;
            cacheWrite: z.ZodOptional<z.ZodNumber>;
            cacheRead: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>>;
        thinkingConfig: z.ZodOptional<z.ZodObject<{
            maxBudget: z.ZodOptional<z.ZodNumber>;
            outputPrice: z.ZodOptional<z.ZodNumber>;
            thinkingLevel: z.ZodOptional<z.ZodEnum<{
                low: "low";
                high: "high";
            }>>;
        }, z.core.$strip>>;
        status: z.ZodOptional<z.ZodEnum<{
            active: "active";
            preview: "preview";
            deprecated: "deprecated";
            legacy: "legacy";
        }>>;
        deprecationNotice: z.ZodOptional<z.ZodString>;
        replacedBy: z.ZodOptional<z.ZodString>;
        releaseDate: z.ZodOptional<z.ZodString>;
        deprecationDate: z.ZodOptional<z.ZodString>;
        family: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodObject<{
            reasoningDefaultOn: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$catchall<z.ZodUnknown>>>;
    }, z.core.$strip>>>;
    providerConfig: z.ZodOptional<z.ZodUnknown>;
    initialMessages: z.ZodOptional<z.ZodArray<z.ZodCustom<Message, Message>>>;
    systemPrompt: z.ZodString;
    tools: z.ZodArray<z.ZodCustom<AgentTool<unknown, unknown>, AgentTool<unknown, unknown>>>;
    maxIterations: z.ZodOptional<z.ZodNumber>;
    maxParallelToolCalls: z.ZodDefault<z.ZodNumber>;
    maxTokensPerTurn: z.ZodOptional<z.ZodNumber>;
    apiTimeoutMs: z.ZodDefault<z.ZodNumber>;
    userFileContentLoader: z.ZodOptional<z.ZodFunction<z.core.$ZodTuple<readonly [z.ZodString], z.core.$ZodFunctionOut>, z.ZodPromise<z.ZodString>>>;
    toolContextMetadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    execution: z.ZodOptional<z.ZodObject<{
        maxConsecutiveMistakes: z.ZodOptional<z.ZodNumber>;
        reminderAfterIterations: z.ZodOptional<z.ZodNumber>;
        reminderText: z.ZodOptional<z.ZodString>;
        loopDetection: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<false>, z.ZodObject<{
            softThreshold: z.ZodOptional<z.ZodNumber>;
            hardThreshold: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>]>>;
    }, z.core.$strip>>;
    reasoningEffort: z.ZodOptional<z.ZodEnum<{
        low: "low";
        high: "high";
        medium: "medium";
        xhigh: "xhigh";
    }>>;
    thinkingBudgetTokens: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodBoolean>;
    onEvent: z.ZodOptional<z.ZodFunction<z.core.$ZodTuple<readonly [z.ZodCustom<AgentEvent, AgentEvent>], z.core.$ZodFunctionOut>, z.ZodVoid>>;
    hooks: z.ZodOptional<z.ZodCustom<Partial<AgentRuntimeHooks>, Partial<AgentRuntimeHooks>>>;
    parentAgentId: z.ZodOptional<z.ZodString>;
    extensions: z.ZodOptional<z.ZodArray<z.ZodCustom<AgentExtension, AgentExtension>>>;
    hookErrorMode: z.ZodDefault<z.ZodEnum<{
        ignore: "ignore";
        throw: "throw";
    }>>;
    toolPolicies: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodObject<{
        enabled: z.ZodOptional<z.ZodBoolean>;
        autoApprove: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
    requestToolApproval: z.ZodOptional<z.ZodFunction<z.core.$ZodTuple<readonly [z.ZodObject<{
        sessionId: z.ZodString;
        agentId: z.ZodString;
        conversationId: z.ZodString;
        iteration: z.ZodNumber;
        toolCallId: z.ZodString;
        toolName: z.ZodString;
        input: z.ZodUnknown;
        policy: z.ZodDefault<z.ZodObject<{
            enabled: z.ZodOptional<z.ZodBoolean>;
            autoApprove: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>;
    }, z.core.$strip>], z.core.$ZodFunctionOut>, z.ZodUnion<readonly [z.ZodObject<{
        approved: z.ZodBoolean;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodPromise<z.ZodObject<{
        approved: z.ZodBoolean;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>]>>>;
    onConsecutiveMistakeLimitReached: z.ZodOptional<z.ZodFunction<z.core.$ZodTuple<readonly [z.ZodObject<{
        iteration: z.ZodNumber;
        consecutiveMistakes: z.ZodNumber;
        maxConsecutiveMistakes: z.ZodNumber;
        reason: z.ZodEnum<{
            api_error: "api_error";
            invalid_tool_call: "invalid_tool_call";
            tool_execution_failed: "tool_execution_failed";
        }>;
        details: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>], z.core.$ZodFunctionOut>, z.ZodUnion<readonly [z.ZodObject<{
        action: z.ZodLiteral<"continue">;
        guidance: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"stop">;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodPromise<z.ZodUnion<readonly [z.ZodObject<{
        action: z.ZodLiteral<"continue">;
        guidance: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>, z.ZodObject<{
        action: z.ZodLiteral<"stop">;
        reason: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>]>>]>>>;
    logger: z.ZodOptional<z.ZodCustom<BasicLogger, BasicLogger>>;
    extensionContext: z.ZodOptional<z.ZodCustom<ExtensionContext, ExtensionContext>>;
    abortSignal: z.ZodOptional<z.ZodCustom<AbortSignal, AbortSignal>>;
}, z.core.$strip>;
/**
 * Pending tool call from the model
 */
export interface PendingToolCall {
    id: string;
    name: string;
    input: unknown;
    signature?: string;
    review?: boolean;
}
/**
 * Processed response from one turn of the loop
 */
export interface ProcessedTurn {
    /** Text output from the model */
    text: string;
    /** Reasoning/thinking content */
    reasoning?: string;
    /** Tool calls requested by the model */
    toolCalls: PendingToolCall[];
    /** Model-emitted tool calls that were invalid or missing required fields */
    invalidToolCalls: Array<{
        id: string;
        name?: string;
        input?: unknown;
        reason: "missing_name" | "missing_arguments" | "invalid_arguments";
    }>;
    /** Token usage for this turn */
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        cost?: number;
    };
    /** Whether the response was truncated */
    truncated: boolean;
    /** Response ID from the API */
    responseId?: string;
}
