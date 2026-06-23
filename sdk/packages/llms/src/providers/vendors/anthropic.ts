import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
<<<<<<< HEAD
} from "@coohu/shared";
=======
} from "@coohu/shared";
import { wrapLanguageModel } from "ai";
>>>>>>> ee59f81706981e0a64c8b32f8f0415c9d39561fa
import { resolveApiKey } from "../http";
import {
	createMiniMaxThinkingFetch,
	miniMaxThinkingDisabledMiddleware,
} from "./minimax-thinking";
import type { ProviderFactoryResult } from "./types";

export async function createAnthropicProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	const apiKey = await resolveApiKey(config);
	const isMiniMax = context.provider.id === "minimax";
	const provider = createAnthropic({
		apiKey,
		baseURL: config.baseUrl,
		headers: config.headers,
		fetch: isMiniMax ? createMiniMaxThinkingFetch(config.fetch) : config.fetch,
		name: context.provider.id,
	});
	return {
		model: (modelId) => {
			const model = provider(modelId);
			return isMiniMax
				? wrapLanguageModel({
						model: model as LanguageModelV3,
						middleware: miniMaxThinkingDisabledMiddleware,
					})
				: model;
		},
	};
}
