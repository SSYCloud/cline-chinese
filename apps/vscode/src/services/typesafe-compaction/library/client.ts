import { buildJevRequest, parseJevResponse } from "./request"
import type { JevAsker, JevQuestions, JevResponse, JevState } from "./types"

export interface JevClientOptions {
	apiKey: string
	model?: string
	baseUrl?: string
	fetch?: typeof fetch
	signal?: AbortSignal
	maxRateLimitRetries?: number
	retryBaseDelayMs?: number
}

const DEFAULT_MAX_RATE_LIMIT_RETRIES = 4
const DEFAULT_RETRY_BASE_DELAY_MS = 2_000

export class JevClient implements JevAsker {
	private readonly apiKey: string
	private readonly model: string | undefined
	private readonly baseUrl: string | undefined
	private readonly fetcher: typeof fetch
	private readonly signal: AbortSignal | undefined
	private readonly maxRateLimitRetries: number
	private readonly retryBaseDelayMs: number

	constructor(options: JevClientOptions) {
		this.apiKey = options.apiKey
		this.model = options.model
		this.baseUrl = options.baseUrl
		this.fetcher = options.fetch ?? fetch
		this.signal = options.signal
		this.maxRateLimitRetries = options.maxRateLimitRetries ?? DEFAULT_MAX_RATE_LIMIT_RETRIES
		this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS
	}

	async ask(state: JevState, questions: JevQuestions): Promise<JevResponse> {
		if (!this.apiKey) {
			throw new Error("决策模型 API Key 未配置")
		}
		const request = buildJevRequest({ apiKey: this.apiKey, model: this.model, baseUrl: this.baseUrl }, state, questions)
		for (let attempt = 0; ; attempt++) {
			const response = await this.fetcher(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body,
				...(this.signal ? { signal: this.signal } : {}),
			})
			if (response.status === 429 && attempt < this.maxRateLimitRetries) {
				await this.sleep(this.retryDelayMs(response.headers.get("retry-after"), attempt))
				continue
			}
			return parseJevResponse(response.status, response.ok, await response.text())
		}
	}

	private retryDelayMs(retryAfter: string | null, attempt: number): number {
		const seconds = retryAfter === null ? Number.NaN : Number(retryAfter)
		if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000
		return this.retryBaseDelayMs * 2 ** attempt
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this.signal?.aborted) {
				reject(this.signal.reason)
				return
			}
			const onAbort = () => {
				clearTimeout(timer)
				reject(this.signal?.reason)
			}
			const timer = setTimeout(() => {
				this.signal?.removeEventListener("abort", onAbort)
				resolve()
			}, ms)
			this.signal?.addEventListener("abort", onAbort, { once: true })
		})
	}
}
