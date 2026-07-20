import type {
	ModelCollection,
	ModelInfo,
	ProviderInfo,
} from "../catalog/types";
export declare function getProviderIds(): string[];
export declare function hasProvider(providerId: string): boolean;
export declare function getProvider(
	providerId: string,
): Promise<ProviderInfo | undefined>;
export declare function getProviderCollectionSync(
	providerId: string,
): ModelCollection | undefined;
export declare function getProviderCollection(
	providerId: string,
): Promise<ModelCollection | undefined>;
export declare function getModelsForProvider(
	providerId: string,
): Promise<Record<string, ModelInfo>>;
export declare function getAllProviders(): Promise<ProviderInfo[]>;
export declare function registerProvider(collection: ModelCollection): void;
export declare function registerModel(
	providerId: string,
	modelId: string,
	info: ModelInfo,
): void;
export declare function unregisterProvider(providerId: string): boolean;
export declare function resetRegistry(): void;
export declare const MODEL_COLLECTIONS_BY_PROVIDER_ID: Record<
	string,
	ModelCollection
>;
