import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@coohu/shared";
import type { AnthropicReasoningRequestPolicy } from "./anthropic-compatible";
import type { ProviderOptionsPatch } from "./utils";
export type AiSdkProviderOptionsTarget =
	| "openai"
	| "openai-compatible"
	| "anthropic"
	| "google"
	| "vertex"
	| "bedrock"
	| "mistral"
	| "claude-code"
	| "openai-codex"
	| "opencode"
	| "dify"
	| "sapaicore";
export type ProviderOptionSuppression = {
	genericThinking?: boolean;
	genericEffort?: boolean;
	genericFanout?: boolean;
};
export type ProviderOptionMatchInput = {
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	providerOptionsKey: string;
	target: AiSdkProviderOptionsTarget;
	isAnthropicCompatibleModelId: boolean;
	anthropicReasoningPolicyKind?: AnthropicReasoningRequestPolicy["kind"];
};
export type ProviderOptionBuildInput = ProviderOptionMatchInput & {
	compatibleOptions: Record<string, unknown>;
	anthropicOptions: Record<string, unknown>;
	suppressions: ProviderOptionSuppression;
};
export type ProviderOptionRule = {
	id: string;
	phase:
		| "adapter"
		| "provider"
		| "provider-fanout"
		| "provider-reasoning"
		| "model-family"
		| "model-overlay";
	description: string;
	applies(input: ProviderOptionMatchInput): boolean;
	suppresses?: ProviderOptionSuppression;
	build(input: ProviderOptionBuildInput): ProviderOptionsPatch | undefined;
};
export type MatchedProviderOptionRule = {
	rule: ProviderOptionRule;
};
export declare function inferProviderOptionsTarget(
	providerId: string,
): AiSdkProviderOptionsTarget;
