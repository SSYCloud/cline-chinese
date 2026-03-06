import { Anthropic } from "@anthropic-ai/sdk"
import { ShengSuanYunModelInfo } from "@shared/proto/cline/models"
import { normalizeOpenaiReasoningEffort } from "@shared/storage/types"
import OpenAI from "openai"
import type {
	ChatCompletionFunctionTool,
	ChatCompletionReasoningEffort,
	ChatCompletionTool,
} from "openai/resources/chat/completions"
import { MessageEvent as UndiciMessageEvent, WebSocket as UndiciWebSocket } from "undici"
import { buildExternalBasicHeaders } from "@/services/EnvUtils"
import { featureFlagsService } from "@/services/feature-flags"
import { ClineStorageMessage } from "@/shared/messages"
import { ApiFormat } from "@/shared/proto/cline/models"
import { FeatureFlag } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import { calculateApiCostOpenAI } from "@/utils/cost"
// import * as vscode from "vscode"
import { shouldSkipReasoningForModel } from "@/utils/model-utils"
import { shengSuanYunDefaultModelId, shengSuanYunDefaultModelInfo } from "../../../shared/api"
import { ApiHandler, CommonApiHandlerOptions } from "../"
import { withRetry } from "../retry"
import { convertToOpenAIResponsesInput } from "../transform/openai-response-format"
import { createOpenRouterStream } from "../transform/openrouter-stream"
import { ApiStream } from "../transform/stream"
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
	private client: OpenAI | undefined
	private abortController?: AbortController
	private responsesWs: UndiciWebSocket | undefined
	private responsesWsReadyPromise: Promise<UndiciWebSocket> | undefined
	private websocketRequestInFlight = false
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
			if (!tools?.length) {
				throw new Error("Native Tool Call must be enabled in your setting for OpenAI Responses API")
			}
			yield* this.createResponseStream(systemPrompt, messages, tools)
		} else {
			throw new Error("Unsupported ShengSuanYun model endpoints")
		}
	}

	private async *createResponseStream(
		systemPrompt: string,
		messages: ClineStorageMessage[],
		tools: ChatCompletionTool[],
	): ApiStream {
		const model = this.getModel()
		const usePreviousResponseId = false //this.useWebsocketMode(model.info.apiFormat)

		// Warm websocket connection early in websocket mode so the first response.create avoids handshake latency.
		if (usePreviousResponseId) {
			this.preconnectResponsesWebsocket()
		}

		const { input, previousResponseId } = convertToOpenAIResponsesInput(messages, { usePreviousResponseId })
		const responseTools = this.mapResponseTools(tools)
		this.abortController = new AbortController()

		const params = this.buildResponseCreateParams({
			modelId: model.id,
			systemPrompt,
			input,
			previousResponseId,
			tools: responseTools,
		})

		const fallbackParams = this.buildResponseCreateParams({
			modelId: model.id,
			systemPrompt,
			input,
			tools: responseTools,
		})

		if (usePreviousResponseId && previousResponseId) {
			try {
				yield* this.createResponseStreamWebsocket(model.info, params, fallbackParams)
				return
			} catch (error) {
				Logger.error("OpenAI websocket mode failed, falling back to HTTP Responses API:", error)
				this.closeResponsesWebsocket()
			}
		}

		yield* this.createResponseStreamHttp(model.info, params)
	}

	private preconnectResponsesWebsocket(): void {
		void this.ensureResponsesWebsocket().catch((error) => {
			Logger.debug("OpenAI websocket preconnect failed:", error)
			this.closeResponsesWebsocket()
		})
	}

	private useWebsocketMode(apiFormat?: ApiFormat): boolean {
		if (featureFlagsService.getBooleanFlagEnabled(FeatureFlag.OPENAI_RESPONSES_WEBSOCKET_MODE)) {
			return apiFormat === ApiFormat.OPENAI_RESPONSES_WEBSOCKET_MODE
		}
		return false
	}

	private mapResponseTools(tools: ChatCompletionTool[]): OpenAI.Responses.Tool[] {
		return tools
			?.filter((tool): tool is ChatCompletionFunctionTool => tool?.type === "function")
			.map((tool) => ({
				type: "function" as const,
				name: tool.function.name,
				description: tool.function.description,
				parameters: tool.function.parameters ?? null,
				strict: tool.function.strict ?? true,
			}))
	}

	private buildResponseCreateParams(args: {
		modelId: string
		systemPrompt: string
		input: OpenAI.Responses.ResponseInput
		tools: OpenAI.Responses.Tool[]
		previousResponseId?: string
	}): OpenAI.Responses.ResponseCreateParamsStreaming {
		const requestedEffort = normalizeOpenaiReasoningEffort(this.options.reasoningEffort)
		const reasoning: { effort: ChatCompletionReasoningEffort; summary: "auto" } | undefined =
			requestedEffort === "none"
				? undefined
				: {
						effort: requestedEffort,
						summary: "auto",
					}

		return {
			model: args.modelId,
			instructions: args.systemPrompt,
			input: args.input,
			stream: true,
			tools: args.tools,
			store: !args.previousResponseId, // Do not use store when websocket mode is enabled.
			...(args.previousResponseId ? { previous_response_id: args.previousResponseId } : {}),
			...(reasoning ? { reasoning } : {}),
		}
	}

	private async *createResponseStreamHttp(
		modelInfo: ShengSuanYunModelInfo,
		params: OpenAI.Responses.ResponseCreateParamsStreaming,
	): ApiStream {
		const client = this.ensureClient()
		Logger.debug(`OpenAI Responses Input (HTTP): ${JSON.stringify(params.input)}`)
		const stream = await client.responses.create(params, { signal: this.abortController?.signal })
		yield* this.processResponsesEvents(stream, modelInfo)
	}

	private async *createResponseStreamWebsocket(
		modelInfo: ShengSuanYunModelInfo,
		primaryParams: OpenAI.Responses.ResponseCreateParamsStreaming,
		fallbackParams: OpenAI.Responses.ResponseCreateParamsStreaming,
	): ApiStream {
		Logger.debug(`OpenAI Responses Input (WebSocket): ${JSON.stringify(primaryParams.input)}`)
		try {
			yield* this.processResponsesEvents(this.createResponseEventsViaWebsocket(primaryParams), modelInfo)
		} catch (error) {
			if (this.shouldRetryWebsocketWithFullContext(error, !!primaryParams.previous_response_id)) {
				Logger.log("Retrying websocket response with full context after previous_response_not_found or socket reset")
				this.closeResponsesWebsocket()
				yield* this.processResponsesEvents(this.createResponseEventsViaWebsocket(fallbackParams), modelInfo)
				return
			}
			throw error
		}
	}

	private shouldRetryWebsocketWithFullContext(error: unknown, hadPreviousResponseId: boolean): boolean {
		const errorCode =
			typeof error === "object" && error && "code" in error && typeof (error as { code: unknown }).code === "string"
				? (error as { code: string }).code
				: undefined

		if (hadPreviousResponseId && errorCode === "previous_response_not_found") {
			return true
		}
		if (errorCode === "websocket_closed" || errorCode === "websocket_error") {
			return true
		}
		return false
	}

	private async ensureResponsesWebsocket(): Promise<UndiciWebSocket> {
		if (this.responsesWs && this.responsesWs.readyState === UndiciWebSocket.OPEN) {
			return this.responsesWs
		}

		if (this.responsesWsReadyPromise) {
			return this.responsesWsReadyPromise
		}

		this.closeResponsesWebsocket()

		if (!this.options.shengSuanYunApiKey) {
			throw new Error("ShengSuanYun API key is required")
		}

		const ws = new UndiciWebSocket("wss://router.shengsuanyun.com/api/v1/responses", {
			headers: {
				Authorization: `Bearer ${this.options.shengSuanYunApiKey}`,
				"OpenAI-Beta": "responses_websockets=2026-02-06",
				...buildExternalBasicHeaders(),
			},
		})

		this.responsesWs = ws
		const readyPromise = new Promise<UndiciWebSocket>((resolve, reject) => {
			const cleanup = () => {
				ws.removeEventListener("open", handleOpen)
				ws.removeEventListener("error", handleError)
				ws.removeEventListener("close", handleClose)
			}
			const handleOpen = () => {
				cleanup()
				resolve(ws)
			}
			const handleError = () => {
				cleanup()
				reject(new Error("Failed to open Responses websocket"))
			}
			const handleClose = () => {
				cleanup()
				reject(new Error("Responses websocket closed before opening"))
			}
			ws.addEventListener("open", handleOpen)
			ws.addEventListener("error", handleError)
			ws.addEventListener("close", handleClose)
		})

		this.responsesWsReadyPromise = readyPromise

		try {
			return await readyPromise
		} catch (error) {
			if (this.responsesWs === ws) {
				this.responsesWs = undefined
			}
			throw error
		} finally {
			if (this.responsesWsReadyPromise === readyPromise) {
				this.responsesWsReadyPromise = undefined
			}
		}
	}

	private closeResponsesWebsocket() {
		this.responsesWsReadyPromise = undefined
		if (this.responsesWs) {
			try {
				this.responsesWs.close()
			} catch {}
			this.responsesWs = undefined
		}
	}

	private async *createResponseEventsViaWebsocket(
		params: OpenAI.Responses.ResponseCreateParamsStreaming,
	): AsyncGenerator<OpenAI.Responses.ResponseStreamEvent> {
		if (this.websocketRequestInFlight) {
			const error: Error & { code?: string } = new Error("Websocket response.create is already in progress")
			error.code = "websocket_concurrency_limit"
			throw error
		}

		const ws = await this.ensureResponsesWebsocket()
		this.websocketRequestInFlight = true

		const eventQueue: OpenAI.Responses.ResponseStreamEvent[] = []
		let resolver: (() => void) | undefined
		let completed = false
		let failure: (Error & { code?: string }) | undefined

		const wake = () => {
			const next = resolver
			resolver = undefined
			next?.()
		}

		const handleMessage = (evt: UndiciMessageEvent) => {
			try {
				let raw = ""
				if (typeof evt.data === "string") {
					raw = evt.data
				} else if (evt.data instanceof ArrayBuffer) {
					raw = new TextDecoder().decode(new Uint8Array(evt.data))
				} else if (ArrayBuffer.isView(evt.data)) {
					raw = new TextDecoder().decode(new Uint8Array(evt.data.buffer, evt.data.byteOffset, evt.data.byteLength))
				} else {
					raw = String(evt.data)
				}
				const parsed = JSON.parse(raw)

				if (parsed?.type === "error" && parsed?.error) {
					const error: Error & { code?: string } = new Error(parsed.error.message || "Responses websocket error")
					error.code = parsed.error.code
					failure = error
					completed = true
					wake()
					return
				}

				eventQueue.push(parsed as OpenAI.Responses.ResponseStreamEvent)
				if (parsed?.type === "response.completed" || parsed?.type === "response.failed") {
					completed = true
				}
				wake()
			} catch (error) {
				const parseError: Error & { code?: string } = new Error(
					`Failed to parse websocket event: ${error instanceof Error ? error.message : String(error)}`,
				)
				parseError.code = "websocket_parse_error"
				failure = parseError
				completed = true
				wake()
			}
		}

		const handleError = () => {
			const error: Error & { code?: string } = new Error("Responses websocket emitted an error event")
			error.code = "websocket_error"
			failure = error
			completed = true
			wake()
		}

		const handleClose = () => {
			if (!completed) {
				const error: Error & { code?: string } = new Error("Responses websocket closed during response stream")
				error.code = "websocket_closed"
				failure = error
				completed = true
				wake()
			}
		}

		ws.addEventListener("message", handleMessage)
		ws.addEventListener("error", handleError)
		ws.addEventListener("close", handleClose)

		try {
			ws.send(
				JSON.stringify({
					type: "response.create",
					...params,
				}),
			)

			while (!completed || eventQueue.length > 0) {
				if (eventQueue.length === 0) {
					await new Promise<void>((resolve) => {
						resolver = resolve
					})
					continue
				}

				const event = eventQueue.shift()
				if (event) {
					yield event
				}
			}

			if (failure) {
				throw failure
			}
		} finally {
			ws.removeEventListener("message", handleMessage)
			ws.removeEventListener("error", handleError)
			ws.removeEventListener("close", handleClose)
			this.websocketRequestInFlight = false
		}
	}

	private async *processResponsesEvents(
		stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
		modelInfo: ShengSuanYunModelInfo,
	): ApiStream {
		const functionCallByItemId = new Map<string, { call_id?: string; name?: string; id?: string }>()

		for await (const chunk of stream) {
			Logger.debug(`OpenAI Responses Chunk: ${JSON.stringify(chunk)}`)

			if (chunk.type === "response.output_item.added") {
				const item = chunk.item
				if (item.type === "function_call" && item.id) {
					functionCallByItemId.set(item.id, { call_id: item.call_id, name: item.name, id: item.id })
					yield {
						type: "tool_calls",
						id: item.id,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					}
				}
				if (item.type === "reasoning" && item.encrypted_content && item.id) {
					yield {
						type: "reasoning",
						id: item.id,
						reasoning: "",
						redacted_data: item.encrypted_content,
					}
				}
			}
			if (chunk.type === "response.output_item.done") {
				const item = chunk.item
				if (item.type === "function_call") {
					if (item.id) {
						functionCallByItemId.set(item.id, { call_id: item.call_id, name: item.name, id: item.id })
					}
					yield {
						type: "tool_calls",
						id: item.id || item.call_id,
						tool_call: {
							call_id: item.call_id,
							function: {
								id: item.id,
								name: item.name,
								arguments: item.arguments,
							},
						},
					}
				}
				if (item.type === "reasoning") {
					yield {
						type: "reasoning",
						id: item.id,
						details: item.summary,
						reasoning: "",
					}
				}
			}
			if (chunk.type === "response.reasoning_summary_part.added") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					reasoning: chunk.part.text,
				}
			}
			if (chunk.type === "response.reasoning_summary_text.delta") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					reasoning: chunk.delta,
				}
			}
			if (chunk.type === "response.reasoning_summary_part.done") {
				yield {
					type: "reasoning",
					id: chunk.item_id,
					details: chunk.part,
					reasoning: "",
				}
			}
			if (chunk.type === "response.output_text.delta") {
				if (chunk.delta) {
					yield {
						id: chunk.item_id,
						type: "text",
						text: chunk.delta,
					}
				}
			}
			if (chunk.type === "response.reasoning_text.delta") {
				if (chunk.delta) {
					yield {
						id: chunk.item_id,
						type: "reasoning",
						reasoning: chunk.delta,
					}
				}
			}
			if (chunk.type === "response.function_call_arguments.delta") {
				const pendingCall = functionCallByItemId.get(chunk.item_id)
				const callId = pendingCall?.call_id
				const functionName = pendingCall?.name
				const functionId = pendingCall?.id || chunk.item_id

				yield {
					type: "tool_calls",
					tool_call: {
						call_id: callId,
						function: {
							id: functionId,
							name: functionName,
							arguments: chunk.delta,
						},
					},
				}
			}
			if (chunk.type === "response.function_call_arguments.done") {
				if (chunk.item_id && chunk.name && chunk.arguments) {
					const pendingCall = functionCallByItemId.get(chunk.item_id)
					const callId = pendingCall?.call_id
					const functionId = pendingCall?.id || chunk.item_id

					yield {
						type: "tool_calls",
						tool_call: {
							call_id: callId,
							function: {
								id: functionId,
								name: chunk.name,
								arguments: chunk.arguments,
							},
						},
					}
				}
			}

			if (
				chunk.type === "response.incomplete" &&
				chunk.response?.status === "incomplete" &&
				chunk.response?.incomplete_details?.reason === "max_output_tokens"
			) {
				if (chunk.response?.output_text?.length > 0) {
					Logger.log("Partial output:", chunk.response.output_text)
				} else {
					Logger.log("Ran out of tokens during reasoning")
				}
			}

			if (chunk.type === "response.completed" && chunk.response?.usage) {
				const usage = chunk.response.usage
				const inputTokens = usage.input_tokens || 0
				const outputTokens = usage.output_tokens || 0
				const cacheReadTokens = usage.input_tokens_details?.cached_tokens || 0
				const cacheWriteTokens = 0
				const reasoningTokens = usage.output_tokens_details?.reasoning_tokens || 0
				const totalTokens = usage.total_tokens || 0
				Logger.log(`Total tokens from Responses API usage: ${totalTokens}`)
				const totalCost = calculateApiCostOpenAI(
					modelInfo,
					inputTokens,
					outputTokens + reasoningTokens,
					cacheWriteTokens,
					cacheReadTokens,
				)
				const nonCachedInputTokens = Math.max(0, inputTokens - cacheReadTokens - cacheWriteTokens)
				yield {
					type: "usage",
					inputTokens: nonCachedInputTokens,
					outputTokens: outputTokens,
					cacheWriteTokens: cacheWriteTokens,
					cacheReadTokens: cacheReadTokens,
					thoughtsTokenCount: reasoningTokens,
					totalCost: totalCost,
					id: chunk.response.id,
				}
			}
		}
	}

	abort(): void {
		this.closeResponsesWebsocket()
		this.abortController?.abort()
		this.abortController = undefined
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
