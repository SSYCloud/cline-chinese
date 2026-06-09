import type { GatewayResolvedProviderConfig } from "@coohu/shared";
import type { ProviderFactoryResult } from "./types";
export declare function createBedrockProviderModule(
	config: GatewayResolvedProviderConfig,
): Promise<ProviderFactoryResult>;
