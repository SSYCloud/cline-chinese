/**
 * Team tool schemas.
 *
 * Zod schemas, constants, and schema-derived types for the team tool surface.
 */
import { z } from "zod";
export declare const DEFAULT_OUTCOME_REQUIRED_SECTIONS: string[];
export declare const TEAM_AWAIT_TIMEOUT_MS: number;
export declare const TEAM_RUN_MESSAGE_PREVIEW_LIMIT = 240;
export declare const TEAM_RUN_TEXT_PREVIEW_LIMIT = 400;
export declare const TeamTeammateSpecSchema: z.ZodObject<{
    agentId: z.ZodString;
    rolePrompt: z.ZodString;
    modelId: z.ZodOptional<z.ZodString>;
    maxIterations: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const TeamSpawnTeammateInputSchema: z.ZodObject<{
    agentId: z.ZodString;
    rolePrompt: z.ZodString;
}, z.core.$strict>;
export declare const TeamShutdownTeammateInputSchema: z.ZodObject<{
    agentId: z.ZodString;
    reason: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare const TeamStatusInputSchema: z.ZodObject<{}, z.core.$strip>;
type TeamTaskAction = "create" | "list" | "claim" | "complete" | "block";
export declare const TEAM_TASK_IGNORED_FIELDS_BY_ACTION: Partial<Record<TeamTaskAction, readonly string[]>>;
export declare const TeamTaskInputSchema: z.ZodObject<{
    action: z.ZodEnum<{
        create: "create";
        list: "list";
        claim: "claim";
        complete: "complete";
        block: "block";
    }>;
    title: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    description: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    dependsOn: z.ZodPreprocess<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    assignee: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    status: z.ZodPreprocess<z.ZodOptional<z.ZodEnum<{
        completed: "completed";
        pending: "pending";
        in_progress: "in_progress";
        blocked: "blocked";
    }>>>;
    taskId: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    summary: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    reason: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare const TeamRunTaskInputSchema: z.ZodObject<{
    agentId: z.ZodString;
    task: z.ZodString;
    taskId: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    runMode: z.ZodPreprocess<z.ZodOptional<z.ZodEnum<{
        sync: "sync";
        async: "async";
    }>>>;
    continueConversation: z.ZodPreprocess<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export declare const TeamListRunsInputSchema: z.ZodObject<{
    status: z.ZodPreprocess<z.ZodOptional<z.ZodEnum<{
        running: "running";
        completed: "completed";
        failed: "failed";
        cancelled: "cancelled";
        queued: "queued";
        interrupted: "interrupted";
    }>>>;
    agentId: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    includeCompleted: z.ZodPreprocess<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export declare const TeamCancelRunInputSchema: z.ZodObject<{
    runId: z.ZodString;
    reason: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare const TeamAwaitRunsInputSchema: z.ZodObject<{
    runId: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
}, z.core.$strict>;
export declare const TeamSendMessageInputSchema: z.ZodObject<{
    toAgentId: z.ZodString;
    subject: z.ZodString;
    body: z.ZodString;
    taskId: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare const TeamBroadcastInputSchema: z.ZodObject<{
    subject: z.ZodString;
    body: z.ZodString;
    taskId: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare const TeamReadMailboxInputSchema: z.ZodObject<{
    unreadOnly: z.ZodPreprocess<z.ZodOptional<z.ZodBoolean>>;
}, z.core.$strip>;
export declare const TeamMissionLogInputSchema: z.ZodObject<{
    kind: z.ZodEnum<{
        error: "error";
        done: "done";
        blocked: "blocked";
        progress: "progress";
        handoff: "handoff";
        decision: "decision";
    }>;
    summary: z.ZodString;
    taskId: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    evidence: z.ZodPreprocess<z.ZodOptional<z.ZodArray<z.ZodString>>>;
    nextAction: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
}, z.core.$strip>;
export declare const TeamCleanupInputSchema: z.ZodObject<{}, z.core.$strip>;
export declare const TeamCreateOutcomeInputSchema: z.ZodObject<{
    title: z.ZodString;
    requiredSections: z.ZodDefault<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const TeamAttachOutcomeFragmentInputSchema: z.ZodObject<{
    outcomeId: z.ZodString;
    section: z.ZodString;
    sourceRunId: z.ZodPreprocess<z.ZodOptional<z.ZodString>>;
    content: z.ZodString;
}, z.core.$strip>;
export declare const TeamReviewOutcomeFragmentInputSchema: z.ZodObject<{
    fragmentId: z.ZodString;
    approved: z.ZodBoolean;
}, z.core.$strip>;
export declare const TeamFinalizeOutcomeInputSchema: z.ZodObject<{
    outcomeId: z.ZodString;
}, z.core.$strip>;
export declare const TeamListOutcomesInputSchema: z.ZodObject<{}, z.core.$strip>;
export type TeamSpawnTeammateInput = z.infer<typeof TeamSpawnTeammateInputSchema>;
export type TeamShutdownTeammateInput = z.infer<typeof TeamShutdownTeammateInputSchema>;
export type TeamStatusInput = z.infer<typeof TeamStatusInputSchema>;
export type TeamTaskInput = z.infer<typeof TeamTaskInputSchema>;
export type TeamRunTaskInput = z.infer<typeof TeamRunTaskInputSchema>;
export type TeamListRunsInput = z.infer<typeof TeamListRunsInputSchema>;
export type TeamCancelRunInput = z.infer<typeof TeamCancelRunInputSchema>;
export type TeamAwaitRunsInput = z.infer<typeof TeamAwaitRunsInputSchema>;
export type TeamSendMessageInput = z.infer<typeof TeamSendMessageInputSchema>;
export type TeamBroadcastInput = z.infer<typeof TeamBroadcastInputSchema>;
export type TeamReadMailboxInput = z.infer<typeof TeamReadMailboxInputSchema>;
export type TeamMissionLogInput = z.infer<typeof TeamMissionLogInputSchema>;
export type TeamCleanupInput = z.infer<typeof TeamCleanupInputSchema>;
export type TeamCreateOutcomeInput = z.infer<typeof TeamCreateOutcomeInputSchema>;
export type TeamAttachOutcomeFragmentInput = z.infer<typeof TeamAttachOutcomeFragmentInputSchema>;
export type TeamReviewOutcomeFragmentInput = z.infer<typeof TeamReviewOutcomeFragmentInputSchema>;
export type TeamFinalizeOutcomeInput = z.infer<typeof TeamFinalizeOutcomeInputSchema>;
export type TeamListOutcomesInput = z.infer<typeof TeamListOutcomesInputSchema>;
export type TeamTeammateSpec = z.infer<typeof TeamTeammateSpecSchema>;
export declare const TeamStatusToolResultSchema: z.ZodObject<{
    teamId: z.ZodString;
    teamName: z.ZodString;
    members: z.ZodArray<z.ZodObject<{
        agentId: z.ZodString;
        role: z.ZodEnum<{
            lead: "lead";
            teammate: "teammate";
        }>;
        description: z.ZodOptional<z.ZodString>;
        status: z.ZodEnum<{
            idle: "idle";
            running: "running";
            stopped: "stopped";
        }>;
    }, z.core.$strip>>;
    taskCounts: z.ZodRecord<z.ZodEnum<{
        completed: "completed";
        pending: "pending";
        in_progress: "in_progress";
        blocked: "blocked";
    }>, z.ZodNumber>;
    unreadMessages: z.ZodNumber;
    missionLogEntries: z.ZodNumber;
    activeRuns: z.ZodNumber;
    queuedRuns: z.ZodNumber;
    outcomeCounts: z.ZodRecord<z.ZodEnum<{
        draft: "draft";
        in_review: "in_review";
        finalized: "finalized";
    }>, z.ZodNumber>;
}, z.core.$strip>;
export declare const TeamTaskListItemToolResultSchema: z.ZodObject<{
    id: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        pending: "pending";
        in_progress: "in_progress";
        blocked: "blocked";
    }>;
    createdAt: z.ZodPreprocess<z.ZodString>;
    updatedAt: z.ZodPreprocess<z.ZodString>;
    createdBy: z.ZodString;
    assignee: z.ZodOptional<z.ZodString>;
    dependsOn: z.ZodArray<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    isReady: z.ZodBoolean;
    blockedBy: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const TeamTaskToolResultSchema: z.ZodDiscriminatedUnion<[z.ZodObject<{
    action: z.ZodLiteral<"create">;
    taskId: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        pending: "pending";
        in_progress: "in_progress";
        blocked: "blocked";
    }>;
    ignoredFields: z.ZodOptional<z.ZodArray<z.ZodString>>;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"list">;
    tasks: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            completed: "completed";
            pending: "pending";
            in_progress: "in_progress";
            blocked: "blocked";
        }>;
        createdAt: z.ZodPreprocess<z.ZodString>;
        updatedAt: z.ZodPreprocess<z.ZodString>;
        createdBy: z.ZodString;
        assignee: z.ZodOptional<z.ZodString>;
        dependsOn: z.ZodArray<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        isReady: z.ZodBoolean;
        blockedBy: z.ZodArray<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"claim">;
    taskId: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        pending: "pending";
        in_progress: "in_progress";
        blocked: "blocked";
    }>;
    nextStep: z.ZodString;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"complete">;
    taskId: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        pending: "pending";
        in_progress: "in_progress";
        blocked: "blocked";
    }>;
}, z.core.$strip>, z.ZodObject<{
    action: z.ZodLiteral<"block">;
    taskId: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        pending: "pending";
        in_progress: "in_progress";
        blocked: "blocked";
    }>;
}, z.core.$strip>], "action">;
export declare const TeamRunTaskToolResultSchema: z.ZodObject<{
    agentId: z.ZodString;
    mode: z.ZodEnum<{
        sync: "sync";
        async: "async";
    }>;
    status: z.ZodEnum<{
        running: "running";
        queued: "queued";
        dispatched: "dispatched";
        joined: "joined";
    }>;
    dispatched: z.ZodBoolean;
    message: z.ZodString;
    deduped: z.ZodOptional<z.ZodBoolean>;
    runId: z.ZodOptional<z.ZodString>;
    text: z.ZodOptional<z.ZodString>;
    iterations: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const TeamRunResultSummarySchema: z.ZodObject<{
    textPreview: z.ZodString;
    iterations: z.ZodNumber;
    finishReason: z.ZodString;
    durationMs: z.ZodNumber;
    usage: z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        cacheReadTokens: z.ZodOptional<z.ZodNumber>;
        cacheWriteTokens: z.ZodOptional<z.ZodNumber>;
        totalCost: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const TeamRunToolSummarySchema: z.ZodObject<{
    id: z.ZodString;
    agentId: z.ZodString;
    taskId: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<{
        running: "running";
        completed: "completed";
        failed: "failed";
        cancelled: "cancelled";
        queued: "queued";
        interrupted: "interrupted";
    }>;
    messagePreview: z.ZodString;
    priority: z.ZodNumber;
    retryCount: z.ZodNumber;
    maxRetries: z.ZodNumber;
    nextAttemptAt: z.ZodOptional<z.ZodPreprocess<z.ZodString>>;
    continueConversation: z.ZodOptional<z.ZodBoolean>;
    startedAt: z.ZodPreprocess<z.ZodString>;
    endedAt: z.ZodOptional<z.ZodPreprocess<z.ZodString>>;
    leaseOwner: z.ZodOptional<z.ZodString>;
    heartbeatAt: z.ZodOptional<z.ZodPreprocess<z.ZodString>>;
    lastProgressAt: z.ZodOptional<z.ZodPreprocess<z.ZodString>>;
    lastProgressMessage: z.ZodOptional<z.ZodString>;
    currentActivity: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    resultSummary: z.ZodOptional<z.ZodObject<{
        textPreview: z.ZodString;
        iterations: z.ZodNumber;
        finishReason: z.ZodString;
        durationMs: z.ZodNumber;
        usage: z.ZodObject<{
            inputTokens: z.ZodNumber;
            outputTokens: z.ZodNumber;
            cacheReadTokens: z.ZodOptional<z.ZodNumber>;
            cacheWriteTokens: z.ZodOptional<z.ZodNumber>;
            totalCost: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strip>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const TeamMailboxMessageToolResultSchema: z.ZodObject<{
    id: z.ZodString;
    teamId: z.ZodString;
    fromAgentId: z.ZodString;
    toAgentId: z.ZodString;
    subject: z.ZodString;
    body: z.ZodString;
    taskId: z.ZodOptional<z.ZodString>;
    sentAt: z.ZodPreprocess<z.ZodString>;
    readAt: z.ZodOptional<z.ZodPreprocess<z.ZodString>>;
}, z.core.$strip>;
export declare const TeamOutcomeToolResultSchema: z.ZodObject<{
    id: z.ZodString;
    teamId: z.ZodString;
    title: z.ZodString;
    status: z.ZodEnum<{
        draft: "draft";
        in_review: "in_review";
        finalized: "finalized";
    }>;
    requiredSections: z.ZodArray<z.ZodString>;
    createdBy: z.ZodString;
    createdAt: z.ZodPreprocess<z.ZodString>;
    finalizedAt: z.ZodOptional<z.ZodPreprocess<z.ZodString>>;
}, z.core.$strip>;
export declare const TeamCreateOutcomeToolResultSchema: z.ZodObject<{
    outcomeId: z.ZodString;
    status: z.ZodEnum<{
        draft: "draft";
        in_review: "in_review";
        finalized: "finalized";
    }>;
    requiredSections: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export declare const TeamSimpleAgentStatusToolResultSchema: z.ZodObject<{
    agentId: z.ZodString;
    status: z.ZodString;
}, z.core.$strip>;
export declare const TeamCancelRunToolResultSchema: z.ZodObject<{
    runId: z.ZodString;
    status: z.ZodEnum<{
        running: "running";
        completed: "completed";
        failed: "failed";
        cancelled: "cancelled";
        queued: "queued";
        interrupted: "interrupted";
    }>;
}, z.core.$strip>;
export declare const TeamSendMessageToolResultSchema: z.ZodObject<{
    id: z.ZodString;
    toAgentId: z.ZodString;
}, z.core.$strip>;
export declare const TeamBroadcastToolResultSchema: z.ZodObject<{
    delivered: z.ZodNumber;
}, z.core.$strip>;
export declare const TeamMissionLogToolResultSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const TeamCleanupToolResultSchema: z.ZodObject<{
    status: z.ZodString;
}, z.core.$strip>;
export declare const TeamOutcomeFragmentToolResultSchema: z.ZodObject<{
    fragmentId: z.ZodString;
    status: z.ZodString;
}, z.core.$strip>;
export declare const TeamFinalizeOutcomeToolResultSchema: z.ZodObject<{
    outcomeId: z.ZodString;
    status: z.ZodEnum<{
        draft: "draft";
        in_review: "in_review";
        finalized: "finalized";
    }>;
}, z.core.$strip>;
export type TeamRunResultSummary = z.infer<typeof TeamRunResultSummarySchema>;
export type TeamRunToolSummary = z.infer<typeof TeamRunToolSummarySchema>;
export type TeamTaskToolResult = z.infer<typeof TeamTaskToolResultSchema>;
export type TeamRunTaskToolResult = z.infer<typeof TeamRunTaskToolResultSchema>;
export type TeamStatusToolResult = z.infer<typeof TeamStatusToolResultSchema>;
export type TeamMailboxMessageToolResult = z.infer<typeof TeamMailboxMessageToolResultSchema>;
export type TeamOutcomeToolResult = z.infer<typeof TeamOutcomeToolResultSchema>;
export type TeamCreateOutcomeToolResult = z.infer<typeof TeamCreateOutcomeToolResultSchema>;
export {};
