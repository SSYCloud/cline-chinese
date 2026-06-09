export interface HookSessionContext {
	rootSessionId?: string;
}
export interface HookSessionContextLookup {
	hookName?: string;
	conversationId?: string;
	agentId?: string;
	parentAgentId?: string | null;
}
export type HookSessionContextProvider =
	| HookSessionContext
	| ((input?: HookSessionContextLookup) => HookSessionContext | undefined);
export declare function resolveHookSessionContext(
	provider?: HookSessionContextProvider,
	input?: HookSessionContextLookup,
): HookSessionContext | undefined;
export declare function resolveRootSessionId(
	context: HookSessionContext | undefined,
): string | undefined;
