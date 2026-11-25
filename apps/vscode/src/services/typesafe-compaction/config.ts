import { DEFAULT_TYPESAFE_MODEL } from "@shared/typesafe-models"

export const JEV_COMPACTION_PLUGIN_NAME = "fast-jev-compaction"
export const TYPESAFE_BASE_URL = "https://router.shengsuanyun.com/api/v1/decisions"
const DEFAULT_TEST_DELETE_THRESHOLD = 0.1
const DEFAULT_CONTEXT_KEEP_THRESHOLD = 0.5

/** Minimal view of the state manager needed to resolve the SystemOne (决策模型) settings. */
export interface TypesafeSettingsSource {
	getSecretKey(key: "typesafeApiKey" | "shengSuanYunApiKey"): string | undefined
	getGlobalSettingsKey(
		key: "typesafeModel" | "typesafeBaseUrl" | "typesafeTestDeleteThreshold" | "typesafeContextDeleteThreshold",
	): string | number | undefined
}

export interface ResolvedTypesafeConfig {
	/** Empty string when no key is configured; callers treat that as "feature unavailable". */
	apiKey: string
	model: string
	/** Undefined means the built-in router endpoint. */
	baseUrl: string | undefined
	/** Tests scoring below this are deleted. 0 disables test pruning. */
	testDeleteThreshold: number
	/** Context tool results/calls scoring below this are dropped. */
	contextDeleteThreshold: number
}

const clamp01 = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback
	return Math.min(1, Math.max(0, value))
}

/**
 * Resolves the global SystemOne (决策模型) configuration. The key falls back to the
 * 胜算云 API Key so users who only configured 胜算云 keep working.
 */
export function resolveTypesafeConfig(source: TypesafeSettingsSource): ResolvedTypesafeConfig {
	const apiKey = (source.getSecretKey("typesafeApiKey") || source.getSecretKey("shengSuanYunApiKey") || "").trim()
	const model = String(source.getGlobalSettingsKey("typesafeModel") ?? "").trim()
	const baseUrl = String(source.getGlobalSettingsKey("typesafeBaseUrl") ?? "").trim()
	return {
		apiKey,
		model: model || DEFAULT_TYPESAFE_MODEL,
		baseUrl: baseUrl || undefined,
		testDeleteThreshold: clamp01(source.getGlobalSettingsKey("typesafeTestDeleteThreshold"), DEFAULT_TEST_DELETE_THRESHOLD),
		contextDeleteThreshold: clamp01(
			source.getGlobalSettingsKey("typesafeContextDeleteThreshold"),
			DEFAULT_CONTEXT_KEEP_THRESHOLD,
		),
	}
}

/** Option values handed to the fast-jev-compaction plugin, taken from the SystemOne settings. */
export function buildJevPluginOptions(typesafe: ResolvedTypesafeConfig): Record<string, string | number> {
	return {
		model: typesafe.model,
		keepThreshold: typesafe.contextDeleteThreshold,
		testDeleteThreshold: typesafe.testDeleteThreshold,
		...(typesafe.apiKey ? { apiKey: typesafe.apiKey } : {}),
		baseUrl: typesafe.baseUrl ?? TYPESAFE_BASE_URL,
	}
}
