import { Anthropic } from "@anthropic-ai/sdk"
import { ShengSuanYunModelInfo } from "@shared/proto/cline/models"
import OpenAI from "openai"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages"
// import { Logger } from "@/shared/services/Logger"
import { shouldSkipReasoningForModel } from "@/utils/model-utils"
import { ModelInfo, shengSuanYunDefaultModelId, shengSuanYunDefaultModelInfo } from "../../../shared/api"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { sanitizeAnthropicMessages } from "../transform/anthropic-format"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream } from "../transform/stream"
import { convertOpenAIToolsToAnthropicTools, handleAnthropicMessagesApiStreamResponse } from "../utils/messages_api_support"
import { handleResponsesApiStreamResponse } from "../utils/responses_api_support"
import { OpenRouterErrorResponse } from "./types"

interface ShengSuanYunHandlerOptions extends CommonApiHandlerOptions {
	shengSuanYunApiKey?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	shengSuanYunModelId?: string
	shengSuanYunModelInfo?: ShengSuanYunModelInfo
}

export class ShengSuanYunHandler implements ApiHandler {
	private options: ShengSuanYunHandlerOptions
	private openAIClient: OpenAI | undefined
	private anthropicClient: Anthropic | undefined
	lastGenerationId?: string

	constructor(options: ShengSuanYunHandlerOptions) {
		this.options = options
	}

	private ensureOpenAIClient(): OpenAI {
		if (!this.openAIClient) {
			if (!this.options.shengSuanYunApiKey) {
				throw new Error("ShengSuanYun API key is required")
			}
			this.openAIClient = new OpenAI({
				baseURL: "https://router.shengsuanyun.com/api/v1",
				apiKey: this.options.shengSuanYunApiKey,
				defaultHeaders: {
					"HTTP-Referer": "vscode://shengsuan-cloud.cline-shengsuan/ssy",
					"X-Title": "ClineShengsuan",
				},
			})
		}
		return this.openAIClient
	}

	private ensureAnthropicClient(): Anthropic {
		if (!this.anthropicClient) {
			if (!this.options.shengSuanYunApiKey) {
				throw new Error("ShengSuanYun API key is required")
			}
			this.anthropicClient = new Anthropic({
				baseURL: "https://router.shengsuanyun.com/api",
				apiKey: this.options.shengSuanYunApiKey,
				defaultHeaders: {
					"HTTP-Referer": "vscode://shengsuan-cloud.cline-shengsuan/ssy",
					"X-Title": "ClineShengsuan",
				},
			})
		}
		return this.anthropicClient
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const endpoints = this.getModel().info.endPoints ?? []
		if (endpoints.includes("/v1/responses")) {
			yield* this.createMessageResponsesApi(systemPrompt, messages, tools)
		} else if (endpoints.includes("/v1/messages")) {
			yield* this.createMessageMessagesApi(systemPrompt, messages, tools)
		} else {
			yield* this.createMessageChatApi(systemPrompt, messages)
		}
	}

	async calculateCost(modelInfo: ModelInfo, inputTokens: number, outputTokens: number) {
		return ((modelInfo.inputPrice || 0) * inputTokens + (modelInfo.outputPrice || 0) * outputTokens) / 1e6
	}

	async *createMessageChatApi(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureOpenAIClient()
		const model = this.getModel()
		const stream = await createOpenRouterStream(
			client,
			systemPrompt,
			messages,
			model,
			this.options.reasoningEffort,
			this.options.thinkingBudgetTokens,
		)

		for await (const chunk of stream) {
			if ("error" in chunk) {
				const error = chunk.error as OpenRouterErrorResponse["error"]
				const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""
				const apiError = new Error(`ShengSuanYun API Error ${error.code}: ${error.message}${metadataStr}`)
				if (error.code === 429 || String(error.code) === "429") {
					;(apiError as any).status = 429
				}
				throw apiError
			}

			if (!chunk.choices?.length) {
				continue
			}

			const choice = chunk.choices[0]
			if ((choice?.finish_reason as string) === "error") {
				const choiceWithError = choice as any
				if (choiceWithError.error) {
					const error = choiceWithError.error
					const streamError = new Error(
						`ShengSuanYun Mid-Stream Error: ${typeof error === "object" ? JSON.stringify(error, null, 2) : String(error)}`,
					)
					if (error?.code === 429 || error?.code === "rate_limit_exceeded" || String(error?.code) === "429") {
						;(streamError as any).status = 429
					}
					throw streamError
				}
				throw new Error("ShengSuanYun Mid-Stream Error: Stream terminated with error status but no error details provided")
			}

			const delta = chunk.choices[0]?.delta
			if (delta?.content) {
				yield { type: "text", text: delta.content }
			}

			if ("reasoning" in delta && delta.reasoning && !shouldSkipReasoningForModel(this.options.shengSuanYunModelId)) {
				// @ts-expect-error-next-line
				yield { type: "reasoning", reasoning: delta.reasoning }
			}

			if (chunk.usage) {
				const input = (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0)
				const output = chunk.usage.completion_tokens || 0
				// @ts-expect-error-next-line
				const cost = (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0)
				yield {
					type: "usage",
					cacheWriteTokens: 0,
					cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
					inputTokens: input,
					outputTokens: output,
					totalCost: cost || (input * (model.info.inputPrice || 0) + output * (model.info.outputPrice || 0)) / 1e6,
				}
			}
		}
	}

	async *createMessageResponsesApi(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureOpenAIClient()
		const model = this.getModel()
		const { input: inputMessages } = convertToOpenAIResponsesInput(messages, { usePreviousResponseId: false })
		const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "system", content: systemPrompt }, ...inputMessages]

		const responseTools = tools
			?.filter((tool) => tool?.type === "function")
			.map((tool: any) => ({
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters,
				strict: tool.function.strict ?? true,
			}))

		const stream = await client.responses.create({
			model: model.id,
			input,
			stream: true,
			tools: responseTools,
			reasoning: { effort: (this.options.reasoningEffort as any) ?? "medium", summary: "auto" },
		})

		yield* handleResponsesApiStreamResponse(stream, model.info as ModelInfo, this.calculateCost.bind(this))
	}

	async *createMessageMessagesApi(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureAnthropicClient()
		const model = this.getModel()
		const budgetTokens = this.options.thinkingBudgetTokens || 0
		const reasoningOn = !!model.info.thinkingConfig && budgetTokens !== 0

		const stream = await client.messages.create({
			model: model.id,
			max_tokens: model.info.maxTokens || 8192,
			temperature: reasoningOn ? undefined : 0,
			system: systemPrompt,
			messages: sanitizeAnthropicMessages(messages, false),
			stream: true,
			tools: convertOpenAIToolsToAnthropicTools(tools),
			thinking: reasoningOn ? { type: "enabled", budget_tokens: budgetTokens } : undefined,
		})

		yield* handleAnthropicMessagesApiStreamResponse(stream)
	}

	getModel(): { id: string; info: ShengSuanYunModelInfo } {
		const { shengSuanYunModelId: modelId, shengSuanYunModelInfo: modelInfo } = this.options
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: shengSuanYunDefaultModelId, info: shengSuanYunDefaultModelInfo as ShengSuanYunModelInfo }
	}
}
