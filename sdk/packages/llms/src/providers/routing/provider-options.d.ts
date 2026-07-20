import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@coohu/shared";
import { type AiSdkProviderOptionsTarget } from "./provider-options-types";
import { type ProviderOptionsPatch } from "./utils";
export type { AiSdkProviderOptionsTarget } from "./provider-options-types";
export type { ProviderOptionsPatch } from "./utils";
/**
 * Merge patches in order. Later patches override earlier ones per bucket key;
 * nested object values are replaced, not deep-merged.
 */
export declare function mergeProviderOptionPatches(
	patches: ReadonlyArray<ProviderOptionsPatch | undefined>,
): Record<string, unknown>;
/**
 * Compose AI SDK `providerOptions` from named provider/model-family rules.
 *
 * The rule table in `provider-option-rules.ts` is the behavior matrix for
 * special providers and model families. Keep the composer boring: build shared
 * buckets once, then merge ordered rule patches.
 *
 * Routing ownership boundary:
 * - Gateway model capabilities say what a model can do, such as reasoning.
 * - Model metadata records stable known-model facts, such as
 *   `reasoningDefaultOn`.
 * - Provider metadata records stable provider policy, such as prompt caching.
 * - Provider-option rules encode abstract request intent into provider wire
 *   formats, such as `reasoning.exclude`, `thinking.type`, or
 *   `reasoningEffort`.
 */
export declare function composeAiSdkProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	target?: AiSdkProviderOptionsTarget,
): Record<string, unknown>;
