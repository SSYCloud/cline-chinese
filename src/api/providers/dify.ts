import { ModelInfo } from "@shared/api"
import { ClineStorageMessage } from "@/shared/messages/content"
import { fetch } from "@/shared/net"
import { ApiHandler } from "../../core/api/index"
import { ApiStream } from "../../core/api/transform/stream"

interface DifyHandlerOptions {
	difyApiKey?: string
	difyBaseUrl?: string
}

export class DifyHandler implements ApiHandler {
	private baseUrl: string
	private apiKey: string
	private conversationId: string | null = null

	constructor(options: DifyHandlerOptions) {
		this.apiKey = options.difyApiKey || ""
		this.baseUrl = options.difyBaseUrl || ""

		if (!this.apiKey) {
			throw new Error("Dify API key is required")
		}
		if (!this.baseUrl) {
			throw new Error("Dify base URL is required")
		}
	}

	async *createMessage(systemPrompt: string, messages: ClineStorageMessage[]): ApiStream {
		// Convert messages to Dify format
		const query = this.convertMessagesToQuery(systemPrompt, messages)
		const requestBody = {
			inputs: {},
			query: query,
			response_mode: "streaming",
			conversation_id: this.conversationId || "",
			user: "cline-user", // A unique user identifier
			files: [],
		}

		const fullUrl = `${this.baseUrl}/chat-messages`
		let response: Response
		try {
			response = await fetch(fullUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${this.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(requestBody),
			})
		} catch (error: any) {
			// Log more detailed error information if available (e.g., from undici)
			const cause = error.cause ? ` | Cause: ${error.cause}` : ""
			throw new Error(`Dify API network error: ${error.message}${cause}`)
		}

		const headersObj: Record<string, string> = {}
		response.headers.forEach((value, key) => {
			headersObj[key] = value
		})
		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`Dify API error: ${response.status} ${response.statusText} - ${errorText}`)
		}

		if (!response.body) {
			throw new Error("No response body from Dify API")
		}

		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ""
		let fullText = ""
		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) {
					break
				}

				const chunk = decoder.decode(value, { stream: true })
				buffer += chunk
				const lines = buffer.split("\n")

				// Keep the last incomplete line in the buffer
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const data = line.slice(6).trim()

						if (data === "[DONE]") {
							return // Explicitly return on [DONE]
						}

						if (data === "") {
							continue
						}

						try {
							const parsed = JSON.parse(data)

							// Capture conversation_id as soon as it's available
							if (parsed.conversation_id && !this.conversationId) {
								this.conversationId = parsed.conversation_id
							}

							// Handle different Dify event types based on actual Dify API
							if (parsed.event === "message") {
								// Dify sends the full text in each "answer" chunk, so we replace.
								if (typeof parsed.answer === "string") {
									fullText = parsed.answer
									yield {
										type: "text",
										text: fullText,
									}
								}
							} else if (parsed.event === "message_replace") {
								if (parsed.answer) {
									fullText = parsed.answer // Replace instead of append
									yield {
										type: "text",
										text: fullText,
									}
								}
							} else if (parsed.event === "message_end") {
								// Message completed. Yield final text if we have any.
								if (fullText) {
									yield {
										type: "text",
										text: fullText,
									}
								}
								// Yield usage data if available
								if (parsed.usage) {
									yield {
										type: "usage",
										inputTokens: parsed.usage.prompt_tokens || 0,
										outputTokens: parsed.usage.completion_tokens || parsed.usage.total_tokens || 0,
										totalCost: parsed.usage.total_price || 0,
									}
								}
								return // End of stream
							} else if (parsed.event === "error") {
								throw new Error(`Dify API error: ${parsed.message || "Unknown error"}`)
							} else if (parsed.event === "workflow_started" || parsed.event === "workflow_finished") {
								// These are informational events, continue processing
							} else if (parsed.event === "node_started" || parsed.event === "node_finished") {
								// These are informational events, continue processing
							} else if (parsed.event === "ping") {
								// Ping event, do nothing
							} else {
								// Try to extract text from other possible fields
								if (parsed.text) {
									fullText += parsed.text
									yield {
										type: "text",
										text: fullText,
									}
								} else if (parsed.content) {
									fullText += parsed.content
									yield {
										type: "text",
										text: fullText,
									}
								}
							}
						} catch (_e) {}
					} else if (line.trim() !== "") {
						// Try to parse as direct JSON (fallback for non-SSE responses, though Dify uses SSE)
						try {
							const parsed = JSON.parse(line.trim())
							// Handle the same event types as above
							if (parsed.event === "message" && parsed.answer) {
								fullText += parsed.answer
								yield {
									type: "text",
									text: fullText,
								}
							} else if (parsed.event === "message_end") {
								if (fullText) {
									yield {
										type: "text",
										text: fullText,
									}
								}
								return
							} else if (parsed.event === "error") {
								throw new Error(`Dify API error: ${parsed.message || "Unknown error"}`)
							}
						} catch (_e) {
							// Not JSON, continue
						}
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}

	private convertMessagesToQuery(systemPrompt: string, messages: ClineStorageMessage[]): string {
		// Dify's context is managed by `conversation_id`. The `query` should be the last user message.
		// The system prompt is typically configured in the Dify App itself.
		const lastUserMessage = messages.filter((m) => m.role === "user").pop()

		if (!lastUserMessage) {
			return "" // Should not happen in normal flow
		}

		const userQuery = Array.isArray(lastUserMessage.content)
			? lastUserMessage.content.map((c) => ("text" in c ? c.text : "")).join("\n")
			: (lastUserMessage.content as string)

		// Only prepend the system prompt if it's the very first message of a new conversation.
		if (!this.conversationId && systemPrompt) {
			return `${systemPrompt}\n\n---\n\n${userQuery}`
		}

		return userQuery
	}

	getModel(): { id: string; info: ModelInfo } {
		return {
			id: "dify-workflow",
			info: {
				maxTokens: 8192,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 0,
				outputPrice: 0,
				description: "Dify workflow - model selection is configured in your Dify application",
			},
		}
	}
}
