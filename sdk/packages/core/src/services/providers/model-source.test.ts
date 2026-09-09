import { describe, expect, it, vi } from "vitest";
import {
	extractShengSuanYunModelsFromPayload,
	fetchModelsFromSource,
} from "./model-source";

describe("extractShengSuanYunModelsFromPayload", () => {
	it("parses ShengSuanYun context window and pricing metadata", () => {
		const models = extractShengSuanYunModelsFromPayload({
			data: [
				{
					api_name: "deepseek/deepseek-v4-flash",
					context_window: 1_000_000,
					max_tokens: 64_000,
					supports_prompt_cache: true,
					architecture: { input: "text,image" },
					description: "DeepSeek via ShengSuanYun",
					pricing: {
						input_price: 1,
						output_price: 2,
						cached_price: 0.02,
					},
					support_apis: ["/v1/messages", "/v1/chat/completions"],
				},
			],
		});

		expect(models["deepseek/deepseek-v4-flash"]).toMatchObject({
			id: "deepseek/deepseek-v4-flash",
			contextWindow: 1_000_000,
			maxInputTokens: 1_000_000,
			maxTokens: 64_000,
			description: "DeepSeek via ShengSuanYun",
			pricing: {
				input: 1,
				output: 2,
				cacheRead: 0.02,
			},
			capabilities: expect.arrayContaining([
				"tools",
				"streaming",
				"images",
				"prompt-cache",
			]),
		});
	});

	it("skips models without the messages endpoint", () => {
		const models = extractShengSuanYunModelsFromPayload({
			data: [
				{
					api_name: "embed/embedding",
					context_window: 128_000,
					support_apis: ["/v1/chat/completions"],
				},
			],
		});

		expect(models).toEqual({});
	});
});

describe("fetchModelsFromSource", () => {
	it("preserves shengsuanyun model metadata", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				return new Response(
					JSON.stringify({
						data: [
							{
								api_name: "anthropic/claude-sonnet-4.6",
								context_window: 200_000,
								max_tokens: 64_000,
								support_apis: ["/v1/messages"],
								pricing: { input_price: 20, output_price: 100 },
							},
						],
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			}),
		);

		try {
			const models = await fetchModelsFromSource(
				"https://router.shengsuanyun.com/api/v1/models/",
				"shengsuanyun",
			);
			expect(models["anthropic/claude-sonnet-4.6"]).toMatchObject({
				contextWindow: 200_000,
				pricing: { input: 20, output: 100 },
			});
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
