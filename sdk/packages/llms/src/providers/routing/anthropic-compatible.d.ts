import type {
	GatewayModelRoute,
	GatewayProviderContext,
	GatewayProviderMetadata,
	GatewayStreamRequest,
} from "@coohu/shared";
export type AnthropicReasoningRequestPolicy =
	| {
			kind: "none";
	  }
	| {
			kind: "anthropic-manual";
	  }
	| {
			kind: "anthropic-adaptive";
	  };
export declare const ANTHROPIC_ROUTING_METADATA: GatewayProviderMetadata;
export declare const QWEN_CACHE_ROUTING_METADATA: GatewayProviderMetadata;
export declare const ANTHROPIC_AND_QWEN_CACHE_ROUTING_METADATA: GatewayProviderMetadata;
export declare function createPromptCacheProviderOptions(
	providerId: string,
	includeAnthropic: boolean,
): Record<string, unknown>;
export declare function applyPromptCacheToLastTextPart(
	message: Record<string, unknown> | undefined,
	providerId: string,
	includeAnthropic: boolean,
): void;
export declare function shouldApplyPromptCache(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean;
export declare function resolvePromptCacheRoute(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): GatewayModelRoute | undefined;
export declare function resolveReasoningRoute(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): GatewayModelRoute | undefined;
export declare function shouldEmitAnthropicReasoning(
	context: GatewayProviderContext,
): boolean;
export declare function resolveAnthropicReasoningRequestPolicy(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): AnthropicReasoningRequestPolicy;
export declare function buildAnthropicProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): {
	cache_control?:
		| {
				type: "ephemeral";
		  }
		| undefined;
	thinking?: Record<string, unknown> | undefined;
	effort?: "low" | "high" | "medium" | undefined;
};
export declare function resolveAnthropicCompatibleReasoningBudget(options: {
	modelId?: string;
	family?: string;
	effort?: string;
	maxTokens?: number;
	explicitBudgetTokens?: number;
}): number | undefined;
export declare function buildAnthropicCompatibleReasoningOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Record<string, unknown> | undefined;
export declare function buildGatewayReasoningOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Record<string, unknown> | undefined;
