import { buildJevRequest, parseJevResponse } from "./request"
import type { JevAsker, JevQuestions, JevResponse, JevState } from "./types"

export interface JevClientOptions {
	apiKey: string
	model?: string
	baseUrl?: string
	fetch?: typeof fetch
	signal?: AbortSignal
}

export class JevClient implements JevAsker {
	private readonly apiKey: string
	private readonly model: string | undefined
	private readonly baseUrl: string | undefined
	private readonly fetcher: typeof fetch
	private readonly signal: AbortSignal | undefined

	constructor(options: JevClientOptions) {
		this.apiKey = options.apiKey
		this.model = options.model
		this.baseUrl = options.baseUrl
		this.fetcher = options.fetch ?? fetch
		this.signal = options.signal
	}

	async ask(state: JevState, questions: JevQuestions): Promise<JevResponse> {
		if (!this.apiKey) {
			throw new Error("胜算云 API Key 未配置")
		}
		const request = buildJevRequest({ apiKey: this.apiKey, model: this.model, baseUrl: this.baseUrl }, state, questions)
		const response = await this.fetcher(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
			...(this.signal ? { signal: this.signal } : {}),
		})
		return parseJevResponse(response.status, response.ok, await response.text())
	}
}
