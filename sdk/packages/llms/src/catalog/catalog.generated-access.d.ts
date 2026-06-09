import type { ModelInfo } from "./types";
export declare function getGeneratedProviderModels(): Record<string, Record<string, ModelInfo>>;
export declare function getGeneratedModelsVersion(): number;
export declare function getGeneratedModelsForProvider(providerId: string): Record<string, ModelInfo>;
