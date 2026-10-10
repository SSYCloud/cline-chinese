import type {
	AgentModelEvent,
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "./ai-sdk";

const sse = (events: Array<{ type: string } & Record<string, unknown>>) =>
	events
		.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
		.join("");

const THINKING_THEN_TOOL_STREAM = sse([
	{
		type: "message_start",
		message: {
			id: "m",
			type: "message",
			role: "assistant",
			model: "test-model",
			content: [],
			usage: { input_tokens: 1, output_tokens: 1 },
		},
	},
	{
		type: "content_block_start",
		index: 0,
		content_block: { type: "thinking", thinking: "" },
	},
	{
		type: "content_block_delta",
		index: 0,
		delta: { type: "thinking_delta", thinking: "hmm" },
	},
	{
		type: "content_block_delta",
		index: 0,
		delta: { type: "signature_delta", signature: "SIG123" },
	},
	{ type: "content_block_stop", index: 0 },
	{
		type: "content_block_start",
		index: 1,
		content_block: { type: "tool_use", id: "t1", name: "noop", input: {} },
	},
	{
		type: "content_block_delta",
		index: 1,
		delta: { type: "input_json_delta", partial_json: "{}" },
	},
	{ type: "content_block_stop", index: 1 },
	{
		type: "message_delta",
		delta: { stop_reason: "tool_use" },
		usage: { output_tokens: 2 },
	},
	{ type: "message_stop" },
]);

describe("Anthropic-protocol thinking signature", () => {
	it("surfaces the signature_delta as reasoning metadata", async () => {
		const config = {
			providerId: "shengsuanyun",
			apiKey: "test-key",
			baseUrl: "http://fake.local/v1",
			fetch: (async () =>
				new Response(THINKING_THEN_TOOL_STREAM, {
					status: 200,
					headers: { "content-type": "text/event-stream" },
				})) as unknown as typeof fetch,
		};
		const provider = await createAnthropicProvider(config);
		const model = {
			id: "test-model",
			providerId: "shengsuanyun",
			name: "test-model",
		};
		const context = {
			provider: {
				id: "shengsuanyun",
				name: "shengsuanyun",
				defaultModelId: "test-model",
				models: [model],
			},
			model,
			config,
		} as unknown as GatewayProviderContext;
		const request = {
			providerId: "shengsuanyun",
			modelId: "test-model",
			messages: [
				{
					id: "msg_user",
					role: "user",
					content: [{ type: "text", text: "go" }],
					createdAt: new Date(),
				},
			],
		} as unknown as GatewayStreamRequest;

		const events: AgentModelEvent[] = [];
		for await (const event of await provider.stream(request, context)) {
			events.push(event);
		}

		const signatures = events
			.filter((e) => e.type === "reasoning-delta")
			.map((e) => (e.metadata as Record<string, unknown> | undefined)?.signature)
			.filter((s) => s !== undefined);
		expect(signatures).toEqual(["SIG123"]);
	});
});
