import type { GatewayProviderFactory } from "@coohu/shared";
import type { AiSdkStreamTotalUsage, AiSdkStreamUsage } from "./vendors/types";
interface GatewayNormalizedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost?: number;
}
/**
 * Normalizes usage from various provider formats into a standard structure.
 * Accepts both AI SDK's normalized shapes (AiSdkStreamTotalUsage, AiSdkStreamUsage)
 * and raw provider responses. Handles multiple naming conventions (camelCase vs snake_case),
 * extracts costs from provider-specific fields, and falls back to pricing-based calculation.
 *
 * @param usageValue - AI SDK normalized usage or raw provider response object
 * @param providerMetadata - Provider-specific metadata for cost extraction
 * @param pricingValue - Fallback pricing config (per 1M tokens) when no explicit cost found
 */
export declare function normalizeUsage(
	usageValue:
		| AiSdkStreamUsage
		| AiSdkStreamTotalUsage
		| Record<string, unknown>
		| undefined,
	providerMetadata?: unknown,
	pricingValue?: unknown,
): GatewayNormalizedUsage;
export declare const createOpenAIProvider: GatewayProviderFactory;
export declare const createOpenAICompatibleProvider: GatewayProviderFactory;
export declare const createAnthropicProvider: GatewayProviderFactory;
export declare const createGoogleProvider: GatewayProviderFactory;
export declare const createVertexProvider: GatewayProviderFactory;
export declare const createBedrockProvider: GatewayProviderFactory;
export declare const createMistralProvider: GatewayProviderFactory;
export declare const createClaudeCodeProvider: GatewayProviderFactory;
export declare const createOpenAICodexProvider: GatewayProviderFactory;
export declare const createOpenCodeProvider: GatewayProviderFactory;
export declare const createDifyProvider: GatewayProviderFactory;
export declare const createSapAiCoreProvider: GatewayProviderFactory;
export {};
