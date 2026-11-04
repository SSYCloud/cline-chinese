import { describe, it } from "bun:test"
import type { CoreCompactionContext } from "@cline/core"
import type { MessageWithMetadata } from "@cline/shared"
import { expect } from "chai"
import { createTypesafePreCompact } from "./precompact"

const LONG_RESULT = "line\n".repeat(240)

function transcript(): MessageWithMetadata[] {
	return [
		{ role: "user", content: "initial request" },
		{
			role: "assistant",
			content: [
				{
					type: "tool_use",
					id: "tool-1",
					name: "read_files",
					input: { path: "/tmp/example.ts" },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "tool-1",
					name: "read_files",
					content: LONG_RESULT,
				},
			],
		},
		{ role: "user", content: "second" },
		{ role: "assistant", content: "reply" },
		{ role: "user", content: "third" },
		{ role: "assistant", content: "reply" },
		{ role: "user", content: "fourth" },
		{ role: "assistant", content: "reply" },
		{ role: "user", content: "fifth" },
	]
}

function context(messages: MessageWithMetadata[]): CoreCompactionContext {
	return {
		agentId: "agent-1",
		conversationId: "conv-1",
		parentAgentId: null,
		iteration: 1,
		messages,
		model: { id: "test-model", provider: "shengsuanyun" },
		mode: "manual",
		abortSignal: new AbortController().signal,
		budget: {
			request: {
				inputTokens: 1_000,
				maxInputTokens: 10_000,
				triggerTokens: 9_000,
				targetTokens: 5_000,
				overheadTokens: 10,
				thresholdRatio: 0.9,
				utilizationRatio: 0.1,
			},
			messages: {
				inputTokens: 990,
				triggerTokens: 8_990,
				targetTokens: 4_990,
			},
		},
	}
}

function answering(score: (name: string) => number, model = "typesafe/jev-latest"): typeof fetch {
	return (async (url: string | URL | Request, init?: RequestInit) => {
		expect(String(url)).to.equal("https://router.shengsuanyun.com/api/v1/decisions")
		expect(new Headers(init?.headers).get("authorization")).to.equal("Bearer key-1")
		const body = JSON.parse(String(init?.body)) as {
			model: string
			questions: Record<string, unknown>
		}
		expect(body.model).to.equal(model)
		const answers = Object.fromEntries(Object.keys(body.questions).map((name) => [name, { noul: score(name) }]))
		return new Response(JSON.stringify({ answers }), { status: 200 })
	}) as typeof fetch
}

describe("createTypesafePreCompact", () => {
	it("is unavailable without an api key", () => {
		expect(createTypesafePreCompact({ apiKey: "  " })).to.equal(undefined)
	})

	it("drops the result of a low-scoring tool call", async () => {
		const preCompact = createTypesafePreCompact({
			apiKey: "key-1",
			fetch: answering((name) => (name.startsWith("result_") ? 0.1 : 0.9)),
		})
		const result = await preCompact?.(context(transcript()))
		const content = result?.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []))
		const call = content?.find((block) => block.type === "tool_use" && block.id === "tool-1")
		const output = content?.find((block) => block.type === "tool_result" && block.tool_use_id === "tool-1")

		expect(call).to.not.equal(undefined)
		expect(output?.type === "tool_result" ? output.content : undefined).to.contain("typesafe-compaction truncated")
	})

	it("drops both the call and its result when neither stays", async () => {
		const preCompact = createTypesafePreCompact({
			apiKey: "key-1",
			fetch: answering(() => 0.1),
		})
		const result = await preCompact?.(context(transcript()))
		const content = result?.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []))

		expect(content?.some((block) => block.type === "tool_use" && block.id === "tool-1")).to.equal(false)
		expect(content?.some((block) => block.type === "tool_result" && block.tool_use_id === "tool-1")).to.equal(false)
	})

	it("uses the configured model", async () => {
		const preCompact = createTypesafePreCompact({
			apiKey: "key-1",
			model: "codiv/openjev-latest",
			fetch: answering(() => 1, "codiv/openjev-latest"),
		})

		expect(await preCompact?.(context(transcript()))).to.equal(undefined)
	})

	it("returns undefined when nothing changes", async () => {
		const preCompact = createTypesafePreCompact({
			apiKey: "key-1",
			fetch: answering(() => 1),
		})

		expect(await preCompact?.(context(transcript()))).to.equal(undefined)
	})
})
