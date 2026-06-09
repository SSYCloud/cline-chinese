import type { GatewayModelRoute, GatewayProviderContext, GatewayReasoningFormat, GatewayStreamRequest } from "@coohu/shared";
export declare function resolveModelFamily(context: GatewayProviderContext): string | undefined;
export declare function normalizeRoutingValue(value: string | undefined): string | undefined;
export declare function isAnthropicCompatibleModel(options: {
    modelId?: string;
    family?: string;
}): boolean;
export declare function isAnthropicCompatibleModelId(modelId: string | undefined): boolean;
export declare function isClaudeModelId(modelId: string | undefined): boolean;
export declare function isQwenModel(options: {
    modelId?: string;
    family?: string;
}): boolean;
export declare function modelRouteMatches(route: GatewayModelRoute, options: {
    modelId?: string;
    family?: string;
    capabilities?: readonly string[];
}): boolean;
export declare function providerReasoningRouteMatches(format: GatewayReasoningFormat, request: Pick<GatewayStreamRequest, "modelId">, context: GatewayProviderContext): boolean;
export declare function isGlmModel(request: Pick<GatewayStreamRequest, "modelId">, context: GatewayProviderContext): boolean;
export declare function isKimiK26Family(context: GatewayProviderContext): boolean;
export declare function isMoonshotKimiModelIdFallback(request: Pick<GatewayStreamRequest, "modelId">): boolean;
export declare function isDeepSeekFamily(context: GatewayProviderContext): boolean;
export declare function getReasoningDefaultOnMetadata(context: GatewayProviderContext): boolean | undefined;
export declare function isOllamaQwen3ModelIdFallback(request: Pick<GatewayStreamRequest, "providerId" | "modelId">): boolean;
export declare function modelReasoningDefaultsOn(options: {
    request: Pick<GatewayStreamRequest, "providerId" | "modelId">;
    context: GatewayProviderContext;
}): boolean;
