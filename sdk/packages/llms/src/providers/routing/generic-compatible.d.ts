import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@coohu/shared";
import type {
	AiSdkProviderOptionsTarget,
	ProviderOptionSuppression,
} from "./provider-options-types";
export declare function buildOpenAINativeProviderOptions(
	request: GatewayStreamRequest,
): Record<string, unknown>;
export declare function buildCompatibleProviderOptions(options: {
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	target: AiSdkProviderOptionsTarget;
	suppressions: ProviderOptionSuppression;
}): Record<string, unknown>;
