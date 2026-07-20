export type ProviderOptionsPatch = Record<string, Record<string, unknown>>;
export declare function toProviderOptionsKey(providerId: string): string;
export declare function createEphemeralCacheControl(): {
	cache_control: {
		type: "ephemeral";
	};
};
/**
 * Target the concrete provider id and, when distinct, its camelCase alias
 * bucket (e.g. `vercel-ai-gateway` + `vercelAiGateway`).
 */
export declare function buildProviderAndAliasPatch(options: {
	providerId: string;
	providerOptionsKey: string;
	bucketOptions: Record<string, unknown>;
}): ProviderOptionsPatch;
export declare function buildThinkingPatch(options: {
	providerId: string;
	providerOptionsKey: string;
	thinkingType: "enabled" | "disabled";
}): ProviderOptionsPatch;
