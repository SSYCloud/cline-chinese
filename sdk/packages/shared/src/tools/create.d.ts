import { z } from "zod";
import type { AgentTool, AgentToolContext } from "../agent";
export declare function createTool<TInput, TOutput>(config: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    execute: (input: TInput, context: AgentToolContext) => Promise<TOutput>;
    lifecycle?: AgentTool<TInput, TOutput>["lifecycle"];
    timeoutMs?: number;
    retryable?: boolean;
    maxRetries?: number;
}): AgentTool<TInput, TOutput>;
export declare function createTool<TSchema extends z.ZodTypeAny, TOutput>(config: {
    name: string;
    description: string;
    inputSchema: TSchema;
    execute: (input: z.infer<TSchema>, context: AgentToolContext) => Promise<TOutput>;
    lifecycle?: AgentTool<z.infer<TSchema>, TOutput>["lifecycle"];
    timeoutMs?: number;
    retryable?: boolean;
    maxRetries?: number;
}): AgentTool<z.infer<TSchema>, TOutput>;
