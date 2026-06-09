import type {
	GatewayProviderContext,
	GatewayProviderMetadata,
	GatewayStreamRequest,
} from "@coohu/shared";
import type { ProviderOptionsPatch } from "./utils";
/**
 * GLM thinking routing.
 *
 * Native Z.AI uses `thinking: { type: "enabled" | "disabled" }`.
 * Routed OpenAI-compatible GLM endpoints should use the generic `reasoning`
 * control shape. The return value is a normal provider-options patch so the
 * composer can rely on merge order instead of out-of-band flags.
 */
export declare const GLM_THINKING_ROUTING_METADATA: GatewayProviderMetadata;
export declare function buildNativeGlmThinkingProviderOptionsPatch(
	request: GatewayStreamRequest,
	providerOptionsKey: string,
): ProviderOptionsPatch | undefined;
export declare function buildRoutedGlmReasoningProviderOptionsPatch(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	providerOptionsKey: string,
	options?: {
		includeProviderBuckets?: boolean;
	},
): ProviderOptionsPatch | undefined;
