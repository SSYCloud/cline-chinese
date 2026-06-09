import type { AgentModel, AgentModelEvent, GatewayConfig, GatewayModelDefinition, GatewayModelHandleOptions, GatewayModelSelection, GatewayProviderRegistration, GatewayStreamRequest } from "@coohu/shared";
import { GatewayRegistry } from "./registry";
export type * from "@coohu/shared";
export interface Gateway {
    registerProvider(registration: GatewayProviderRegistration): this;
    configureProvider(config: NonNullable<GatewayConfig["providerConfigs"]>[number]): this;
    listProviders(): ReturnType<GatewayRegistry["listProviders"]>;
    listModels(providerId?: string): ReturnType<GatewayRegistry["listModels"]>;
    createAgentModel(selection: GatewayModelSelection, options?: GatewayModelHandleOptions): AgentModel;
    stream(request: GatewayStreamRequest): Promise<AsyncIterable<AgentModelEvent>>;
}
export declare function estimateRequestInputTokens(request: Pick<GatewayStreamRequest, "systemPrompt" | "messages" | "tools">): number;
export declare function resolveGatewayRequestMaxTokens(input: {
    requestedMaxTokens?: number;
    model: Pick<GatewayModelDefinition, "contextWindow" | "maxOutputTokens">;
    estimatedInputTokens: number;
    outputReserveTokens?: number;
    onContextOverflow?: (details: {
        contextWindow: number;
        estimatedInputTokens: number;
        reserveTokens: number;
    }) => void;
}): number | undefined;
export declare class DefaultGateway implements Gateway {
    private readonly registry;
    private readonly logger;
    private readonly telemetry;
    constructor(config?: GatewayConfig);
    registerProvider(registration: GatewayProviderRegistration): this;
    configureProvider(config: NonNullable<GatewayConfig["providerConfigs"]>[number]): this;
    listProviders(): import("@coohu/shared").GatewayProviderManifest[];
    listModels(providerId?: string): GatewayModelDefinition[];
    createAgentModel(selection: GatewayModelSelection, options?: GatewayModelHandleOptions): AgentModel;
    stream(request: GatewayStreamRequest): Promise<AsyncIterable<AgentModelEvent>>;
}
export declare function createGateway(config?: GatewayConfig): DefaultGateway;
