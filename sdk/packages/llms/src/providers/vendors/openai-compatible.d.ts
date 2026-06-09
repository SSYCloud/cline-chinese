import type { GatewayProviderContext, GatewayResolvedProviderConfig } from "@coohu/shared";
import type { ProviderFactoryResult } from "./types";
export declare function createOpenAICompatibleProviderModule(config: GatewayResolvedProviderConfig, context: GatewayProviderContext): Promise<ProviderFactoryResult>;
