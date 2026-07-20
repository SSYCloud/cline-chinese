import { z } from "zod";
import type { ToolCallRecord } from "../llms/tools";
import type { HookSessionContext } from "../session/hook-context";
import type { WorkspaceInfo } from "../session/workspace";
import type { HookControl } from "./contracts";
type AgentHookControl = Omit<HookControl, "appendMessages"> & {
	systemPrompt?: string;
	appendMessages?: unknown[];
};
export interface AgentHookRunStartPayload {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	userMessage: string;
}
export interface AgentHookToolCallStartPayload {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	call: {
		id: string;
		name: string;
		input: unknown;
	};
}
export interface AgentHookToolCallEndPayload {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	record: ToolCallRecord;
}
export interface AgentHookTurnEndPayload {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	turn: unknown;
}
export interface AgentHookStopErrorPayload {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	iteration: number;
	error: Error;
}
export interface AgentHookSessionShutdownPayload {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
	reason?: string;
}
export declare const HookEventNameSchema: z.ZodEnum<{
	tool_result: "tool_result";
	agent_start: "agent_start";
	agent_resume: "agent_resume";
	agent_abort: "agent_abort";
	agent_end: "agent_end";
	agent_error: "agent_error";
	tool_call: "tool_call";
	prompt_submit: "prompt_submit";
	pre_compact: "pre_compact";
	session_shutdown: "session_shutdown";
}>;
export type HookEventName = z.infer<typeof HookEventNameSchema>;
export interface PreToolUseData {
	toolName: string;
	parameters: Record<string, string>;
}
export interface PostToolUseData {
	toolName: string;
	parameters: Record<string, string>;
	result: string;
	success: boolean;
	executionTimeMs: number;
}
export interface UserPromptSubmitData {
	prompt: string;
	attachments: string[];
}
export interface TaskStartData {
	taskMetadata: Record<string, string>;
}
export interface TaskResumeData {
	taskMetadata: Record<string, string>;
	previousState: Record<string, string>;
}
export interface TaskCancelData {
	taskMetadata: Record<string, string>;
}
export interface TaskCompleteData {
	taskMetadata: Record<string, string>;
}
export interface PreCompactData {
	taskId: string;
	ulid: string;
	contextSize: number;
	compactionStrategy: string;
	previousApiReqIndex: number;
	tokensIn: number;
	tokensOut: number;
	tokensInCache: number;
	tokensOutCache: number;
	deletedRangeStart: number;
	deletedRangeEnd: number;
	contextJsonPath: string;
	contextRawPath: string;
}
export interface HookEventPayloadBase {
	clineVersion: string;
	hookName: HookEventName;
	timestamp: string;
	taskId: string;
	sessionContext?: HookSessionContext;
	workspaceRoots: string[];
	/**
	 * Structured workspace and git metadata for the session.
	 *
	 * Contains `rootPath`, `hint`, `associatedRemoteUrls`,
	 * `latestGitCommitHash`, and `latestGitBranchName` — the same data as
	 * `workspaceRoots[0]` plus the git fields. Hook scripts can use this for
	 * branch-aware logic or commit attribution without running `git` themselves.
	 *
	 * `undefined` when the session has no workspace metadata (e.g. unit tests
	 * or sessions started without a `cwd`).
	 */
	workspaceInfo?: WorkspaceInfo;
	userId: string;
	agent_id: string;
	parent_agent_id: string | null;
	preToolUse?: PreToolUseData | undefined;
	postToolUse?: PostToolUseData | undefined;
	userPromptSubmit?: UserPromptSubmitData | undefined;
	taskStart?: TaskStartData | undefined;
	taskResume?: TaskResumeData | undefined;
	taskCancel?: TaskCancelData | undefined;
	taskComplete?: TaskCompleteData | undefined;
	preCompact?: PreCompactData | undefined;
}
export interface ToolCallHookPayload extends HookEventPayloadBase {
	hookName: "tool_call";
	iteration: number;
	tool_call: {
		id: string;
		name: string;
		input: unknown;
	};
}
export interface ToolResultHookPayload extends HookEventPayloadBase {
	hookName: "tool_result";
	iteration: number;
	tool_result: ToolCallRecord;
}
export interface AgentEndHookPayload extends HookEventPayloadBase {
	hookName: "agent_end";
	iteration: number;
	turn?: unknown;
}
export interface AgentErrorHookPayload extends HookEventPayloadBase {
	hookName: "agent_error";
	iteration: number;
	error: {
		name: string;
		message: string;
		stack?: string;
	};
}
export interface AgentStartHookPayload extends HookEventPayloadBase {
	hookName: "agent_start";
}
export interface AgentResumeHookPayload extends HookEventPayloadBase {
	hookName: "agent_resume";
}
export interface AgentAbortHookPayload extends HookEventPayloadBase {
	hookName: "agent_abort";
	reason?: string;
}
export interface PromptSubmitHookPayload extends HookEventPayloadBase {
	hookName: "prompt_submit";
}
export interface PreCompactHookPayload extends HookEventPayloadBase {
	hookName: "pre_compact";
	preCompact: PreCompactData;
}
export interface SessionShutdownHookPayload extends HookEventPayloadBase {
	hookName: "session_shutdown";
	reason?: string;
}
export type HookEventPayload =
	| ToolCallHookPayload
	| ToolResultHookPayload
	| AgentStartHookPayload
	| AgentResumeHookPayload
	| AgentAbortHookPayload
	| PromptSubmitHookPayload
	| PreCompactHookPayload
	| AgentEndHookPayload
	| AgentErrorHookPayload
	| SessionShutdownHookPayload;
export declare const HookEventPayloadSchema: z.ZodType<unknown>;
export declare function parseHookEventPayload(
	value: unknown,
): HookEventPayload | undefined;
export type SubprocessHookControl = AgentHookControl;
export {};
