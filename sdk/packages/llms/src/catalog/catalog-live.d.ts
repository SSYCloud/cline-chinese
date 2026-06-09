import type { ModelInfo } from "./types";
export interface ModelsDevModel {
	name?: string;
	tool_call?: boolean;
	reasoning?: boolean;
	structured_output?: boolean;
	temperature?: boolean;
	release_date?: string;
	family?: string;
	limit?: {
		context?: number;
		input?: number;
		output?: number;
	};
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	modalities?: {
		input?: string[];
	};
	status?: string;
}
interface ModelsDevProviderPayload {
	models?: Record<string, ModelsDevModel>;
}
export type ModelsDevPayload = Record<string, ModelsDevProviderPayload>;
export type ModelsDevProviderKeyMap = Record<string, string>;
export declare function sortModelsByReleaseDate(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo>;
export declare function resolveMaxInputTokens(
	limit: ModelsDevModel["limit"] | undefined,
): number;
export declare function normalizeModelsDevProviderModels(
	payload: ModelsDevPayload,
): Record<string, Record<string, ModelInfo>>;
export declare function fetchModelsDevProviderModels(
	url: string,
	fetcher?: typeof fetch,
): Promise<Record<string, Record<string, ModelInfo>>>;
export {};
