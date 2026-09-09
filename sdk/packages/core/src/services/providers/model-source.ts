import type { ModelInfo } from "@cline/llms";

function parseModelIdList(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	return input
		.map((item) => {
			if (typeof item === "string") return item.trim();
			if (item && typeof item === "object") {
				const entry = item as { id?: unknown; name?: unknown; model?: unknown };
				for (const value of [entry.id, entry.name, entry.model]) {
					if (typeof value === "string" && value.trim()) {
						return value.trim();
					}
				}
			}
			return "";
		})
		.filter((id) => id.length > 0);
}

export function extractModelIdsFromPayload(
	payload: unknown,
	providerId: string,
): string[] {
	const rootArray = parseModelIdList(payload);
	if (rootArray.length > 0) return rootArray;
	if (!payload || typeof payload !== "object") return [];

	const data = payload as {
		data?: unknown;
		models?: unknown;
		providers?: Record<string, unknown>;
	};

	const direct = parseModelIdList(data.data ?? data.models);
	if (direct.length > 0) return direct;

	if (
		data.models &&
		typeof data.models === "object" &&
		!Array.isArray(data.models)
	) {
		const keys = Object.keys(data.models).filter((k) => k.trim().length > 0);
		if (keys.length > 0) return keys;
	}

	const scoped = data.providers?.[providerId];
	if (scoped && typeof scoped === "object") {
		const nested = scoped as { models?: unknown };
		const list = parseModelIdList(nested.models ?? scoped);
		if (list.length > 0) return list;
	}

	return [];
}

export async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
): Promise<string[]> {
	const response = await fetch(url, { method: "GET" });
	if (!response.ok) {
		throw new Error(
			`failed to fetch models from ${url}: HTTP ${response.status}`,
		);
	}
	return extractModelIdsFromPayload(
		(await response.json()) as unknown,
		providerId,
	);
}

function toFiniteNumber(value: unknown): number | undefined {
	const parsed =
		typeof value === "number"
			? value
			: typeof value === "string"
				? Number(value)
				: NaN;
	if (!Number.isFinite(parsed)) {
		return undefined;
	}
	return parsed;
}

function toNonNegativeNumber(value: unknown): number | undefined {
	const parsed = toFiniteNumber(value);
	return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function toPositiveInteger(value: unknown): number | undefined {
	const parsed = toFiniteNumber(value);
	if (parsed === undefined || parsed <= 0) {
		return undefined;
	}
	return Math.floor(parsed);
}

/**
 * Parse ShengSuanYun's `/api/v1/models` payload. The provider reports full
 * model metadata (context window, max output tokens, pricing in RMB per
 * million tokens, prompt-cache support, and image input support), which must
 * flow through to the catalog so the TaskHeader can show the real context
 * window and the SDK can compute usage cost with the correct prices.
 */
export function extractShengSuanYunModelsFromPayload(
	payload: unknown,
): Record<string, ModelInfo> {
	if (!payload || typeof payload !== "object") {
		return {};
	}

	const root = payload as { data?: unknown };
	if (!Array.isArray(root.data)) {
		return {};
	}

	const models: Record<string, ModelInfo> = {};
	for (const rawModel of root.data) {
		if (!rawModel || typeof rawModel !== "object") {
			continue;
		}
		const model = rawModel as Record<string, unknown>;
		const apiName = model.api_name;
		if (typeof apiName !== "string" || !apiName.trim()) {
			continue;
		}
		const supportApis = Array.isArray(model.support_apis)
			? model.support_apis
			: [];
		if (!supportApis.includes("/v1/messages")) {
			continue;
		}

		const inputArch =
			typeof model.architecture === "object" && model.architecture !== null
				? (model.architecture as Record<string, unknown>).input
				: undefined;
		const supportsImages =
			typeof inputArch === "string" &&
			inputArch.toLowerCase().includes("image");

		const pricing =
			typeof model.pricing === "object" && model.pricing !== null
				? (model.pricing as Record<string, unknown>)
				: {};
		const inputPrice = toNonNegativeNumber(pricing.input_price);
		const outputPrice = toNonNegativeNumber(pricing.output_price);
		const cacheReadPrice = toNonNegativeNumber(pricing.cached_price);
		const cacheWritePrice = toNonNegativeNumber(pricing.cache_write_price);
		const contextWindow = toPositiveInteger(model.context_window);
		const maxTokens = toPositiveInteger(model.max_tokens);
		const capabilities: NonNullable<ModelInfo["capabilities"]> = [
			"tools",
			"streaming",
		];
		if (supportsImages) {
			capabilities.push("images");
		}
		if (model.supports_prompt_cache) {
			capabilities.push("prompt-cache");
		}

		const result: ModelInfo = {
			id: apiName.trim(),
			name: apiName.trim(),
			capabilities,
			status: "active",
		};
		if (contextWindow !== undefined) {
			result.contextWindow = contextWindow;
			result.maxInputTokens = contextWindow;
		}
		if (maxTokens !== undefined) {
			result.maxTokens = maxTokens;
		}
		if (inputPrice !== undefined || outputPrice !== undefined) {
			result.pricing = {
				...(inputPrice !== undefined ? { input: inputPrice } : {}),
				...(outputPrice !== undefined ? { output: outputPrice } : {}),
				...(cacheReadPrice !== undefined ? { cacheRead: cacheReadPrice } : {}),
				...(cacheWritePrice !== undefined
					? { cacheWrite: cacheWritePrice }
					: {}),
			};
		}
		if (typeof model.description === "string") {
			result.description = model.description;
		}

		models[result.id] = result;
	}

	return models;
}

/**
 * Fetch provider public model metadata. For providers whose public endpoint
 * carries full model details (currently ShengSuanYun), return typed models so
 * context-window and pricing data are preserved instead of degrading to
 * id-only entries. All other providers keep the previous id-only behavior.
 */
export async function fetchModelsFromSource(
	url: string,
	providerId: string,
): Promise<Record<string, ModelInfo>> {
	const response = await fetch(url, { method: "GET" });
	if (!response.ok) {
		throw new Error(
			`failed to fetch models from ${url}: HTTP ${response.status}`,
		);
	}
	const payload = (await response.json()) as unknown;
	if (providerId === "shengsuanyun") {
		return extractShengSuanYunModelsFromPayload(payload);
	}
	return Object.fromEntries(
		extractModelIdsFromPayload(payload, providerId).map((id) => [
			id,
			{ id, name: id },
		]),
	);
}

function trimTrailingSlash(value: string): string {
	return value.replace(/\/+$/, "");
}

export function resolveModelsSourceUrl(
	baseUrl: string | undefined,
	defaultBaseUrl: string | undefined,
	modelsSourceUrl: string | undefined,
): string | undefined {
	const source = modelsSourceUrl?.trim();
	if (!source) return undefined;
	const configuredBase = baseUrl?.trim();
	if (!configuredBase || !defaultBaseUrl?.trim()) return source;

	try {
		const sourceUrl = new URL(source);
		const defaultBase = new URL(defaultBaseUrl);
		const configured = new URL(configuredBase);
		if (sourceUrl.origin !== defaultBase.origin) return source;

		const defaultPath = trimTrailingSlash(defaultBase.pathname);
		const configuredPath = trimTrailingSlash(configured.pathname);
		if (defaultPath && sourceUrl.pathname.startsWith(`${defaultPath}/`)) {
			const suffix = sourceUrl.pathname.slice(defaultPath.length);
			configured.pathname = `${configuredPath}${suffix}`;
		} else {
			configured.pathname = sourceUrl.pathname;
		}
		configured.search = sourceUrl.search;
		configured.hash = sourceUrl.hash;
		return configured.toString();
	} catch {
		return source;
	}
}
