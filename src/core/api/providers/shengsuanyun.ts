import { Anthropic } from "@anthropic-ai/sdk"
import { ShengSuanYunModelInfo } from "@shared/proto/cline/models"
import OpenAI from "openai"
import type { ChatCompletionTool } from "openai/resources/chat/completions"
import { ClineStorageMessage } from "@/shared/messages"
import { Logger } from "@/shared/services/Logger"
import { shouldSkipReasoningForModel } from "@/utils/model-utils"
import { ModelInfo, shengSuanYunDefaultModelId, shengSuanYunDefaultModelInfo } from "../../../shared/api"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream } from "../transform/stream"
import { OpenRouterErrorResponse } from "./types"
import type { ChatCompletionTool as OpenAITool } from "openai/resources/chat/completions"
import { handleResponsesApiStreamResponse } from "../utils/responses_api_support"

interface ShengSuanYunHandlerOptions extends CommonApiHandlerOptions {
	shengSuanYunApiKey?: string
	reasoningEffort?: string
	thinkingBudgetTokens?: number
	shengSuanYunModelId?: string
	shengSuanYunModelInfo?: ShengSuanYunModelInfo
}

export class ShengSuanYunHandler implements ApiHandler {
	private options: ShengSuanYunHandlerOptions
	private client: OpenAI | undefined
	lastGenerationId?: string

	constructor(options: ShengSuanYunHandlerOptions) {
		this.options = options
	}

	private ensureClient(): OpenAI {
		if (!this.client) {
			if (!this.options.shengSuanYunApiKey) {
				throw new Error("shengsuanyun API key is required")
			}
			try {
				this.client = new OpenAI({
					baseURL: "https://router.shengsuanyun.com/api/v1",
					apiKey: this.options.shengSuanYunApiKey,
					defaultHeaders: {
						"HTTP-Referer": `vscode://shengsuan-cloud.cline-shengsuan/ssy`,
						"X-Title": "ClineShengsuan",
					},
				})
			} catch (error: any) {
				throw new Error(`Error creating shengsuanyun client: ${error.message}`)
			}
		}
		return this.client
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[], tools?: ChatCompletionTool[]): ApiStream {
		const model = this.getModel()
		if (model?.info?.endPoints?.includes("/v1/chat/completions")) {
			yield* this.createCompletionStream(systemPrompt, messages)
		} else if (model?.info?.endPoints?.includes("/v1/responses")) {
			yield* this.createMessageResponsesApi(systemPrompt, messages, tools)
		} else {
			throw new Error("Unsupported ShengSuanYun model endpoints")
		}
	}

	async calculateCost( modelInfo: ModelInfo, inputTokens: number, outputTokens: number, _cacheWriteTokens?: number, _cacheReadTokens?: number) {
		const inputCost = modelInfo.inputPrice || 0
		const outputCost = modelInfo.outputPrice || 0
		const totalCost = (inputCost * inputTokens) / 1e6 + (outputCost * outputTokens) / 1e6
		return totalCost
	}

	async *createMessageResponsesApi(systemPrompt: string, messages: ClineStorageMessage[], tools?: OpenAITool[]): ApiStream {
		const client = this.ensureClient()
		const inputMessages = convertToOpenAIResponsesInput(messages, { usePreviousResponseId: false }).input
		const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "system", content: systemPrompt }, ...inputMessages]
		const responseTools = tools?.filter((tool) => tool?.type === "function")
			.map((tool: any) => ({
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters,
				strict: tool.function.strict ?? true, // Responses API defaults to strict mode
			}))

		const responsesParams: OpenAI.Responses.ResponseCreateParamsStreaming = {
			model: this.options.shengSuanYunModelId || shengSuanYunDefaultModelId,
			input,
			stream: true,
			tools: responseTools,
		}

		const modelInfo = this.options.shengSuanYunModelInfo
		if (!modelInfo) {
			throw new Error("未找到模型详细信息！")
		}
		const stream = await client.responses.create(responsesParams)
		yield* handleResponsesApiStreamResponse(stream, modelInfo, this.calculateCost.bind(this))
	}

	async *createCompletionStream(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const client = this.ensureClient()
		const model = this.getModel()
		try {
			const stream = await createOpenRouterStream(
				client,
				systemPrompt,
				messages,
				model,
				this.options.reasoningEffort,
				this.options.thinkingBudgetTokens,
			)

			for await (const chunk of stream) {
				// openrouter returns an error object instead of the openai sdk throwing an error
				if ("error" in chunk) {
					const error = chunk.error as OpenRouterErrorResponse["error"]
					Logger.error(`ShengSuanYun API Error: ${error?.code} - ${error?.message}`)
					// Include metadata in the error message if available
					const metadataStr = error.metadata ? `\nMetadata: ${JSON.stringify(error.metadata, null, 2)}` : ""

					// Create a proper error object with status for retry logic
					const apiError = new Error(`ShengSuanYun API Error ${error.code}: ${error.message}${metadataStr}`)
					// Set status for rate limit detection
					if (error.code === 429 || String(error.code) === "429") {
						;(apiError as any).status = 429
					}
					throw apiError
				}

				if (!chunk.choices || chunk.choices.length === 0) {
					Logger.error("shengSuanYun stream chunk:", chunk)
					continue
				}

				const choice = chunk.choices?.[0]
				// Use type assertion since OpenRouter uses non-standard "error" finish_reason
				if ((choice?.finish_reason as string) === "error") {
					// Use type assertion since OpenRouter adds non-standard error property
					const choiceWithError = choice as any
					if (choiceWithError.error) {
						const error = choiceWithError.error
						Logger.error(
							`ShengSuanYun Mid-Stream Error: ${error?.code || "Unknown"} - ${error?.message || "Unknown error"}`,
						)
						// Format error details
						const errorDetails = typeof error === "object" ? JSON.stringify(error, null, 2) : String(error)

						// Create a proper error object with status for retry logic
						const streamError = new Error(`ShengSuanYun Mid-Stream Error: ${errorDetails}`)
						if (error?.code === 429 || error?.code === "rate_limit_exceeded" || String(error?.code) === "429") {
							;(streamError as any).status = 429
						}
						throw streamError
					}
					// Fallback if error details are not available
					throw new Error(
						`ShengSuanYun Mid-Stream Error: Stream terminated with error status but no error details provided`,
					)
				}

				const delta = chunk.choices[0]?.delta
				if (delta?.content) {
					yield {
						type: "text",
						text: delta.content,
					}
				}

				// Reasoning tokens are returned separately from the content
				// Skip reasoning content for Grok 4 models since it only displays "thinking" without providing useful information
				if ("reasoning" in delta && delta.reasoning && !shouldSkipReasoningForModel(this.options.shengSuanYunModelId)) {
					yield {
						type: "reasoning",
						// @ts-expect-error-next-line
						reasoning: delta.reasoning,
					}
				}
				if (chunk.usage) {
					const input = (chunk.usage.prompt_tokens || 0) - (chunk.usage.prompt_tokens_details?.cached_tokens || 0)
					const output = chunk.usage.completion_tokens || 0
					// @ts-expect-error-next-line
					const cost = (chunk.usage.cost || 0) + (chunk.usage.cost_details?.upstream_inference_cost || 0)
					const inputPrice = model.info.inputPrice || 0
					const outputPrice = model.info.outputPrice || 0
					yield {
						type: "usage",
						cacheWriteTokens: 0,
						cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens || 0,
						inputTokens: input,
						outputTokens: output,
						totalCost: cost ? cost : (input / 1000000) * inputPrice + (output / 1000000) * outputPrice,
					}
				}
			}
		} catch (e) {
			Logger.log(e)
			throw e
		}
	}

	getModel(): { id: string; info: ShengSuanYunModelInfo } {
		const modelId = this.options.shengSuanYunModelId
		const modelInfo = this.options.shengSuanYunModelInfo
		if (modelId && modelInfo) {
			return { id: modelId, info: modelInfo }
		}
		return { id: shengSuanYunDefaultModelId, info: shengSuanYunDefaultModelInfo as ShengSuanYunModelInfo }
	}
}
