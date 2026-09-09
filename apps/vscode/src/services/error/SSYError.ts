import {
	getClineOrgIndividualInferenceSubscriptionMessage,
	isClineFreeModelLimitMessage,
	isClineNotSubscribedMessage,
	isClineOrgIndividualInferenceSubscriptionMessage,
	isClinePassLimitMessage,
} from "@cline/llms"
import { serializeError } from "serialize-error"
import { CLINE_ACCOUNT_AUTH_ERROR_MESSAGE } from "../../shared/ClineAccount"

export enum SSYErrorType {
	Auth = "auth",
	Network = "network",
	RateLimit = "rateLimit",
	Balance = "balance",
	SpendLimit = "spendLimit",
	QuotaExceeded = "quotaExceeded",
	TpmLimitExceeded = "tpmLimitExceeded",
	RpmLimitExceeded = "rpmLimitExceeded",
	Entitlement = "entitlement",
	OrgClinePassRestriction = "orgClinePassRestriction",
	ClinePassLimit = "clinePassLimit",
	ClineFreeModelLimit = "clineFreeModelLimit",
}

export const SSY_PROVIDER_ID = "shengsuanyun"
export const SSY_BUY_CREDITS_URL = "https://console.shengsuanyun.com/user/recharge"

interface ErrorDetails {
	/**
	 * The HTTP status code of the error, if applicable.
	 */
	status?: number
	/**
	 * The request ID associated with the error, if available.
	 * This can be useful for debugging and support.
	 */
	request_id?: string
	/**
	 * Specific error code provided by the API or service.
	 */
	code?: string
	/**
	 * The model ID associated with the error, if applicable.
	 * This is useful for identifying which model the error relates to.
	 */
	modelId?: string
	/**
	 * The provider ID associated with the error, if applicable.
	 * This is useful for identifying which provider the error relates to.
	 */
	providerId?: string
	/**
	 * The error message associated with the error, if applicable.
	 */
	message?: string
	// Additional details that might be present in the error
	// This can include things like current balance, error messages, etc.
	details?: any
}

const RATE_LIMIT_PATTERNS = [/status code 429/i, /rate limit/i, /too many requests/i, /quota exceeded/i, /resource exhausted/i]

const BALANCE_PATTERNS = [
	/用户余额不足/i,
	/账户余额不足/i,
	/余额不足/i,
	/insufficient[ _-]?quota/i,
	/insufficient[ _-]?(?:balance|credits)/i,
	/not enough (?:balance|credits)/i,
]

const NETWORK_PATTERNS = [
	/network error/i,
	/socket hang up/i,
	/fetch failed/i,
	/connect(?:ion)? (?:refused|reset|closed)/i,
	/etimedout/i,
	/econnreset/i,
	/econnrefused/i,
]

const AUTH_MESSAGE_PATTERNS = [
	/(?:invalid|unauthorized|missing) (?:api )?(?:key|token)/i,
	/authentication[ _-]?failed/i,
	/unauthorized/i,
	/认证失败/i,
	/登录(?:已)?过期/i,
]

export class SSYError extends Error {
	readonly title = "SSYError"
	readonly _error: ErrorDetails

	// Error details per providers:
	// Cline: error?.error
	// Ollama: error?.cause
	// tbc
	constructor(
		raw: any,
		public modelId?: string,
		public providerId?: string,
	) {
		const error = serializeError(raw)

		const message = error.message || error?.response?.message || String(error) || error?.cause?.means
		super(message)

		// Extract status from multiple possible locations
		const status = error.status || error.statusCode || error.response?.status
		this.modelId = modelId || error.modelId
		this.providerId = providerId || error.providerId || SSY_PROVIDER_ID

		// Construct the error details object to includes relevant information
		// And ensure it has a consistent structure
		this._error = {
			...error,
			message: raw.message || message,
			status,
			request_id:
				error.error?.request_id ||
				error.request_id ||
				error.response?.request_id ||
				error.response?.headers?.["x-request-id"],
			code: error.code || error?.cause?.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: error.details || error.error, // Additional details provided by the server
			stack: undefined, // Avoid serializing stack trace to keep the error object clean
		}
	}

	/**
	 *  Serializes the error to a JSON string that allows for easy transmission and storage.
	 *  This is useful for logging or sending error details to a webviews.
	 */
	public serialize(): string {
		return JSON.stringify({
			message: this.message,
			status: this._error.status,
			request_id: this._error.request_id,
			code: this._error.code,
			modelId: this.modelId,
			providerId: this.providerId,
			details: this._error.details,
		})
	}

	public get status(): number | undefined {
		return this._error.status
	}

	public get requestId(): string | undefined {
		return this._error.request_id
	}

	public get code(): string | undefined {
		return this._error.code
	}

	/**
	 * Parses a stringified error into a SSYError instance.
	 */
	static parse(errorStr?: string, modelId?: string, providerId?: string): SSYError | undefined {
		if (!errorStr || typeof errorStr !== "string") {
			return undefined
		}
		return SSYError.transform(errorStr, modelId, providerId)
	}

	/**
	 * Transforms any object into a SSYError instance.
	 * Always returns a SSYError, even if the input is not a valid error object.
	 */
	static transform(error: any, modelId?: string, providerId?: string): SSYError {
		try {
			// If already a SSYError, return it directly to prevent infinite recursion
			if (error instanceof SSYError) {
				return error
			}
			return new SSYError(JSON.parse(error), modelId, providerId)
		} catch {
			return new SSYError(error, modelId, providerId)
		}
	}

	public isErrorType(type: SSYErrorType): boolean {
		return SSYError.getErrorType(this) === type
	}

	/**
	 * Is known error type based on the error code, status, and details.
	 * This is useful for determining how to handle the error in the UI or logic.
	 */
	static getErrorType(err: SSYError): SSYErrorType | undefined {
		const { code, status, details } = err._error
		const rawMessage = err._error?.message || err.message || JSON.stringify(err._error)
		const detailMessage = typeof details?.message === "string" ? details.message : undefined
		const messages = [rawMessage, detailMessage, typeof details === "string" ? details : undefined].filter(
			Boolean,
		) as string[]

		// Check balance error first (most specific)
		if (
			code === "insufficient_quota" ||
			code === "insufficient_balance" ||
			code === "insufficient_credits" ||
			messages.some((message) => BALANCE_PATTERNS.some((pattern) => pattern.test(message)))
		) {
			return SSYErrorType.Balance
		}

		// Check spend limit exceeded (org-enforced budget cap, 429 SPEND_LIMIT_EXCEEDED)
		// Must be checked before the generic rate-limit check since both use 429
		if (code === "SPEND_LIMIT_EXCEEDED" || details?.code === "SPEND_LIMIT_EXCEEDED") {
			return SSYErrorType.SpendLimit
		}

		if (
			rawMessage === getClineOrgIndividualInferenceSubscriptionMessage() ||
			(detailMessage ? isClineOrgIndividualInferenceSubscriptionMessage(detailMessage) : false) ||
			(rawMessage ? isClineOrgIndividualInferenceSubscriptionMessage(rawMessage) : false)
		) {
			return SSYErrorType.OrgClinePassRestriction
		}

		if (
			(detailMessage ? isClineNotSubscribedMessage(detailMessage) : false) ||
			(rawMessage ? isClineNotSubscribedMessage(rawMessage) : false)
		) {
			return SSYErrorType.Entitlement
		}

		if (
			(detailMessage ? isClineFreeModelLimitMessage(detailMessage) : false) ||
			(rawMessage ? isClineFreeModelLimitMessage(rawMessage) : false)
		) {
			return SSYErrorType.ClineFreeModelLimit
		}

		if (
			(detailMessage ? isClinePassLimitMessage(detailMessage) : false) ||
			(rawMessage ? isClinePassLimitMessage(rawMessage) : false)
		) {
			return SSYErrorType.ClinePassLimit
		}

		// Check auth errors: ShengSuanYun rejects invalid/expired x-token or API key.
		const isAuthStatus = status === 401 || status === 403
		if (
			code === "ERR_BAD_REQUEST" ||
			code === "UNAUTHORIZED" ||
			code === "INVALID_TOKEN" ||
			code === "AUTH_REQUIRED" ||
			isAuthStatus ||
			err instanceof AuthInvalidTokenError ||
			messages.some((message) => AUTH_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) ||
			messages.some((message) => message.includes(CLINE_ACCOUNT_AUTH_ERROR_MESSAGE))
		) {
			return SSYErrorType.Auth
		}

		// Check quota exceeded errors
		if (code === "quota_exceeded" || messages.some((message) => /quota[ _-]?exceeded/i.test(message))) {
			return SSYErrorType.QuotaExceeded
		}

		if (code === "tpm_limit_exceeded" || messages.some((message) => /tpm[ _-]?limit/i.test(message))) {
			return SSYErrorType.TpmLimitExceeded
		}

		if (code === "rpm_limit_exceeded" || messages.some((message) => /rpm[ _-]?limit/i.test(message))) {
			return SSYErrorType.RpmLimitExceeded
		}

		// Check rate limit patterns
		const message = err.message
		if (message) {
			const lowerMessage = message.toLowerCase()
			if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(lowerMessage))) {
				return SSYErrorType.RateLimit
			}
		}

		// Check network errors
		if (message && NETWORK_PATTERNS.some((pattern) => pattern.test(message))) {
			return SSYErrorType.Network
		}

		return undefined
	}
}

export class AuthInvalidTokenError extends Error {
	constructor(message: string) {
		super(message)
		this.name = SSYErrorType.Auth
	}
}
