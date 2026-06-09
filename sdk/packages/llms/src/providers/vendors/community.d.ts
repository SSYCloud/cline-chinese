import type { GatewayResolvedProviderConfig } from "@coohu/shared";
import type { ProviderFactoryResult } from "./types";
export declare function createClaudeCodeProviderModule(config: GatewayResolvedProviderConfig): Promise<ProviderFactoryResult>;
export declare function createOpenAICodexProviderModule(config: GatewayResolvedProviderConfig): Promise<ProviderFactoryResult>;
export declare function createOpenCodeProviderModule(config: GatewayResolvedProviderConfig): Promise<ProviderFactoryResult>;
export declare function createDifyProviderModule(config: GatewayResolvedProviderConfig): Promise<ProviderFactoryResult>;
export declare function createSapAiCoreProviderModule(config: GatewayResolvedProviderConfig): Promise<ProviderFactoryResult>;
