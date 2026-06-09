import type { GatewayModelDefinition, GatewayModelSelection, GatewayProviderConfig, GatewayProviderFactory, GatewayProviderManifest, GatewayProviderRegistration, GatewayResolvedModel, GatewayResolvedProviderConfig } from "@coohu/shared";
export declare class GatewayRegistry {
    private readonly providers;
    private readonly providerConfigs;
    private readonly fallbackFetch?;
    constructor(fetchImpl?: typeof fetch);
    registerProvider(registration: GatewayProviderRegistration): void;
    configureProvider(config: GatewayProviderConfig): void;
    listProviders(): GatewayProviderManifest[];
    listModels(providerId?: string): GatewayModelDefinition[];
    getManifest(providerId: string): GatewayProviderManifest | undefined;
    resolveModel(selection: GatewayModelSelection): GatewayResolvedModel;
    createProvider(providerId: string): Promise<{
        manifest: GatewayProviderManifest;
        config: GatewayResolvedProviderConfig;
        createProvider: GatewayProviderFactory;
    }>;
}
