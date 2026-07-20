export type ProviderUsageCostDisplay = "show" | "hide";
export declare function resolveProviderUsageCostDisplay(
	providerId: string,
): ProviderUsageCostDisplay;
export declare function shouldShowProviderUsageCost(
	providerId: string,
): boolean;
