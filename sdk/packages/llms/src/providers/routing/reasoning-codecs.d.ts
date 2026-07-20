import type { GatewayStreamRequest } from "@coohu/shared";
export declare function hasReasoningControls(
	reasoning: GatewayStreamRequest["reasoning"],
): boolean;
export declare function buildOpenRouterReasoningOptions(
	request: GatewayStreamRequest,
): Record<string, unknown> | undefined;
