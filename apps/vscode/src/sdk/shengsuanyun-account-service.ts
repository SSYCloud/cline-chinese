import {
	EAccount,
	EAccountList,
	EnterpriseBillRequest,
	EnterpriseBillResponse,
	EnterpriseBudget,
	EnterpriseBudgetRequest,
	EPAPIKey,
	PaymentTransaction,
	UsageTransaction,
	UserCreditsBalance,
	UserCreditsData,
	UserInfo,
} from "@shared/proto/cline/account"
import axios, { type AxiosRequestConfig } from "axios"
import { StateManager } from "@/core/storage/StateManager"
import { getAxiosSettings } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { isJwtExpired } from "@/shared/utils/jwt"

const SSY_AUTH_ERROR_CODES = new Set([20001, 20003])

export class ShengSuanYunAuthError extends Error {
	constructor(
		message: string,
		public readonly code: number,
		public readonly scope: "session" | "enterprise" = "session",
	) {
		super(message)
		this.name = "ShengSuanYunAuthError"
	}
}

export class ShengSuanYunAccountService {
	private static instance: ShengSuanYunAccountService
	private readonly baseUrl = "https://api.shengsuanyun.com"
	private readonly enterpriseTokens = new Map<string, { token: string; expiresAt: number; sessionToken: string }>()
	private readonly enterpriseTokenRequests = new Map<string, { sessionToken: string; promise: Promise<string> }>()

	/**
	 * Returns the singleton instance of ShengSuanYunAccountService
	 */
	public static getInstance(): ShengSuanYunAccountService {
		if (!ShengSuanYunAccountService.instance) {
			ShengSuanYunAccountService.instance = new ShengSuanYunAccountService()
		}
		return ShengSuanYunAccountService.instance
	}

	/**
	 * Helper function to make authenticated requests to the ShengSuanYun API.
	 * Uses the "x-token" credential stored in StateManager secrets.
	 *
	 * @param overrideToken - Credential to send instead of the stored session
	 *   token (e.g. the enterprise-scoped token returned by `enterEnterprise`).
	 */
	private async authenticatedRequest<T>(
		endpoint: string,
		config: AxiosRequestConfig = {},
		allowNullData = false,
		overrideToken?: string,
	): Promise<T> {
		const token = overrideToken ?? StateManager.get().getSecretKey("shengSuanYunToken")
		if (!token) {
			throw new Error("ShengSuanYunAccountService.authenticatedRequest() 未找到胜算云 Auth Token")
		}
		const method = config.method || "GET"
		const cacheBustingEndpoint = method.toUpperCase() !== "POST" ? this.withCacheBust(endpoint) : endpoint
		const url = `${this.baseUrl}${cacheBustingEndpoint}`
		const requestConfig: AxiosRequestConfig = {
			timeout: 50000,
			...config,
			url,
			method,
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "no-cache, no-store, max-age=0",
				...config.headers,
				"x-token": token,
			},
			...getAxiosSettings(),
		}
		const response = await axios.request<{ data?: T; code?: number; msg?: string }>(requestConfig)
		const body = response.data
		if (!body) {
			throw new Error(`Invalid response from ${endpoint} API`)
		}
		if (typeof body.code === "number" && body.code !== 0) {
			const message = `${body.msg || "Unknown error"} (${endpoint}, code ${body.code})`
			if (SSY_AUTH_ERROR_CODES.has(body.code)) {
				throw new ShengSuanYunAuthError(message, body.code, overrideToken ? "enterprise" : "session")
			}
			throw new Error(`ShengSuanYun API error: ${message}`)
		}
		if (!allowNullData && body.data == null) {
			throw new Error(`Invalid response from ${endpoint} API`)
		}
		return body.data as T
	}

	private withCacheBust(endpoint: string): string {
		const separator = endpoint.includes("?") ? "&" : "?"
		return `${endpoint}${separator}_t=${Date.now()}`
	}

	private async enterEnterprise(enterpriseId: number, ramUserId?: number): Promise<string> {
		const sessionToken = StateManager.get().getSecretKey("shengSuanYunToken")
		if (!sessionToken) {
			throw new Error("ShengSuanYunAccountService.enterEnterprise() 未找到胜算云 Auth Token")
		}
		const cacheKey = `${enterpriseId}:${ramUserId ?? 0}`
		const cached = this.enterpriseTokens.get(cacheKey)
		if (cached && cached.sessionToken === sessionToken && !isJwtExpired(cached.token, 60)) {
			return cached.token
		}
		const inFlight = this.enterpriseTokenRequests.get(cacheKey)
		if (inFlight && inFlight.sessionToken === sessionToken) {
			return inFlight.promise
		}
		const promise = this.enterEnterpriseRequested(cacheKey, enterpriseId, sessionToken).finally(() => {
			if (this.enterpriseTokenRequests.get(cacheKey)?.promise === promise) {
				this.enterpriseTokenRequests.delete(cacheKey)
			}
		})
		this.enterpriseTokenRequests.set(cacheKey, { sessionToken, promise })
		return promise
	}

	private async enterEnterpriseRequested(cacheKey: string, enterpriseId: number, sessionToken: string): Promise<string> {
		const d = await this.authenticatedRequest<{ token?: string; account_type?: string; expires_at?: number }>(
			"/enterprise_gateway/enterprise/enter",
			{ method: "POST", data: { enterprise_id: enterpriseId } },
		)
		const token = d?.token
		if (!token) {
			if (d?.account_type === "main") {
				this.enterpriseTokens.set(cacheKey, {
					token: "",
					expiresAt: Number.POSITIVE_INFINITY,
					sessionToken,
				})
				return ""
			}
			throw new Error(`Invalid response from API: enterprise/enter ${JSON.stringify(d)}`)
		}
		const expiresAt = typeof d.expires_at === "number" ? d.expires_at : Number.POSITIVE_INFINITY
		this.enterpriseTokens.set(cacheKey, { token, expiresAt, sessionToken })
		return token
	}

	private async enterpriseTokenOrSession(enterpriseId: number | undefined, ramUserId?: number): Promise<string | undefined> {
		if (!enterpriseId) {
			return undefined
		}
		const token = await this.enterEnterprise(enterpriseId, ramUserId)
		return token || undefined
	}

	private dateQueryString(): string {
		const endDate = new Date()
		const startDate = new Date(endDate)
		startDate.setDate(endDate.getDate() - 3)
		const formatDate = (date: Date): string => {
			const year = date.getFullYear()
			const month = String(date.getMonth() + 1).padStart(2, "0")
			const day = String(date.getDate()).padStart(2, "0")
			return `${year}-${month}-${day}`
		}
		return `startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}`
	}

	async getUserInfo(): Promise<UserInfo> {
		try {
			const res = await this.authenticatedRequest<any>("/user/info")
			if (!res || (res.ID === undefined && !res.Username && !res.Email)) {
				throw new ShengSuanYunAuthError("Invalid response from API: /user/info (no account identity)", 20003)
			}
			return UserInfo.create({
				uid: String(res.ID ?? ""),
				displayName: res.Nickname || res.Username || undefined,
				email: res.Email ?? undefined,
				photoUrl: res.HeadImg ?? undefined,
				balance: res.Wallet?.Assets != null ? res.Wallet.Assets / 10000 : undefined,
			})
		} catch (error) {
			Logger.error("getUserInfo() (ShengSuanYun):", error)
			throw error
		}
	}

	async fetchUserDataRPC(): Promise<UserCreditsData> {
		try {
			const dqs = this.dateQueryString()
			const [usage, payment, user] = await Promise.all([
				this.authenticatedRequest<any>(`/modelrouter/userlog?page=1&pageSize=1000&${dqs}`),
				this.authenticatedRequest<any>("/modelrouter/listrecharge?page=1&pageSize=10000"),
				this.getUserInfo(),
			])
			if (!usage || typeof usage !== "object" || !Array.isArray(usage.logs)) {
				throw new Error("ShengSuanYunAccountService.fetchUserDataRPC() 无效的使用记录数据")
			}
			if (!payment || typeof payment !== "object" || !Array.isArray(payment.records)) {
				throw new Error("ShengSuanYunAccountService.fetchUserDataRPC() 无效的充值记录数据")
			}

			const usageTransactions: UsageTransaction[] = usage.logs.map((it: any) =>
				UsageTransaction.create({
					createdAt: it.request_time,
					aiModelName: `${it.model?.company}/${it.model?.name}`,
					creditsUsed: it.total_amount,
					totalTokens: it.total_amount,
					promptTokens: it.input_tokens,
					completionTokens: it.output_tokens,
				}),
			)

			const paymentTransactions: PaymentTransaction[] = payment.records.map((it: any) =>
				PaymentTransaction.create({
					paidAt: it.create_at,
					creatorId: "",
					amountCents: Math.round(it.price),
					credits: 0,
				}),
			)

			return UserCreditsData.create({
				balance: UserCreditsBalance.create({ currentBalance: user.balance ?? 0 }),
				usageTransactions,
				paymentTransactions,
				user,
			})
		} catch (error) {
			Logger.error("ShengSuanYunAccountService.fetchUserDataRPC():", error)
			throw error
		}
	}

	async getEnterpriseAccounts(): Promise<EAccountList> {
		try {
			const res = await this.authenticatedRequest<{ accounts?: any[] }>("/enterprise_gateway/account/associated_api_keys")
			if (!Array.isArray(res.accounts)) {
				throw new Error(`Invalid response from API: associated_api_keys ${JSON.stringify(res)}`)
			}
			return EAccountList.create({
				accounts: res.accounts.map(
					(a: any): EAccount =>
						EAccount.create({
							accountType: a.account_type ?? "",
							userId: a.user_id ?? 0,
							ramUserId: a.ram_user_id ?? 0,
							accountId: a.account_id ?? 0,
							name: a.name ?? "",
							status: a.status ?? 0,
							authority: a.authority ?? "",
							maskedPhone: a.masked_phone ?? "",
							enterpriseId: a.enterprise_id ?? 0,
							enterpriseName: a.enterprise_name ?? "",
							apiKeyCount: a.api_key_count ?? 0,
							projects: (a.projects ?? []).map((p: any) => ({
								id: p.project_id ?? 0,
								name: p.project_name ?? "",
								models: [],
								routers: [],
								apiKeys: (p.api_keys ?? []).map(
									(k: any): EPAPIKey => ({
										id: k.id ?? 0,
										createdAt: k.created_at ?? "",
										updatedAt: "",
										userId: a.user_id ?? 0,
										isBanned: false,
										isExpired: !!k.expires_at && new Date(k.expires_at).getTime() < Date.now(),
										name: k.name ?? "",
										desc: k.desc ?? "",
										key: k.key ?? "",
										token: k.token ?? "",
										tpm: k.tpm ?? 0,
										rpm: k.rpm ?? 0,
										maxQuota: k.max_quota ?? 0,
										consumedAmount: k.consumed_amount ?? 0,
										supportedModels: "",
										isDefault: k.is_default ?? false,
										ramUserId: a.ram_user_id ?? 0,
										enterpriseGatewayProjectId: p.project_id ?? 0,
									}),
								),
							})),
						}),
				),
			})
		} catch (error) {
			Logger.error("getEnterpriseAccounts():", error)
			throw error
		}
	}

	private async withEnterpriseScope<T>(
		enterpriseId: number | undefined,
		ramUserId: number | undefined,
		request: (token: string | undefined) => Promise<T>,
	): Promise<T> {
		const token = await this.enterpriseTokenOrSession(enterpriseId, ramUserId)
		try {
			return await request(token)
		} catch (error) {
			if (!(error instanceof ShengSuanYunAuthError) || error.scope !== "enterprise" || !enterpriseId) {
				throw error
			}
			this.enterpriseTokens.delete(`${enterpriseId}:${ramUserId ?? 0}`)
			const freshToken = await this.enterpriseTokenOrSession(enterpriseId, ramUserId)
			return request(freshToken)
		}
	}

	async getEnterpriseBill(qs: EnterpriseBillRequest): Promise<EnterpriseBillResponse> {
		if (!qs.tokenName) {
			return EnterpriseBillResponse.create({ bills: [] })
		}
		const endTime = qs.endTime ?? new Date().toISOString()
		const startTime = qs.startTime ?? new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString()
		const params = new URLSearchParams({
			project_id: String(qs.projectId ?? 0),
			token_name: qs.tokenName,
			start_time: startTime,
			end_time: endTime,
			page: String(qs.page ?? 1),
			page_size: String(Math.min(qs.pageSize ?? 100, 100)),
		})
		try {
			// Usage records are readable only from the enterprise the project
			// belongs to; the personal login token answers "api token not found".
			const res = await this.withEnterpriseScope(qs.enterpriseId, qs.ramUserId, (enterpriseToken) =>
				this.authenticatedRequest<{ llm_records?: any[] }>(
					`/project/apikey/usage/recent?${params.toString()}`,
					{},
					false,
					enterpriseToken,
				),
			)
			return EnterpriseBillResponse.create({
				bills: (res.llm_records ?? []).map((r: any) => ({
					hourTime: r.end_at ?? "",
					userName: "",
					modelName: r.model_name ?? "",
					userId: 0,
					ramUserId: 0,
					requestCount: 1,
					providerName: "",
					totalDeductionAmount: r.total_amount ?? 0,
					cachedAmount: 0,
					totalPromptTokens: 0,
					totalCompletionTokens: 0,
					totalTokens: r.total_tokens ?? 0,
					tokenName: qs.tokenName,
					requestIp: r.request_ip ?? "",
					requestId: r.request_id ?? "",
				})),
			})
		} catch (error) {
			Logger.error("getEnterpriseBill():", error)
			throw error
		}
	}

	/**
	 * Fetches the current account's personal budget for a project. Returns
	 * hasBudget=false when the API reports null (main account, no limit, etc.).
	 */
	async getEnterpriseBudget(qs: EnterpriseBudgetRequest): Promise<EnterpriseBudget> {
		try {
			// Budget is per enterprise member; the personal token returns `null`
			// (indistinguishable from "no limit"), so resolve the scoped token.
			const d = await this.withEnterpriseScope(qs.enterpriseId, qs.ramUserId, (enterpriseToken) =>
				this.authenticatedRequest<any | null>(
					`/enterprise_gateway/budget/detail?project_id=${qs.projectId || 0}`,
					{},
					true,
					enterpriseToken,
				),
			)
			if (d == null) {
				return EnterpriseBudget.create({ hasBudget: false })
			}
			if (typeof d !== "object") {
				throw new Error(`Invalid response from API: budget/detail ${JSON.stringify(d)}`)
			}
			return EnterpriseBudget.create({
				hasBudget: true,
				accountId: String(d.account_id ?? ""),
				accountName: d.account_name ?? "",
				budgetKind: d.budget_kind ?? "",
				periodStart: d.period_start ?? "",
				periodEnd: d.period_end ?? "",
				projectId: d.project_id ?? 0,
				projectName: d.project_name ?? "",
				ramUserId: d.ram_user_id ?? 0,
				remainingCny: d.remaining_cny ?? 0,
				remainingPercentage: d.remaining_percentage ?? 0,
				totalCny: d.total_cny ?? 0,
				usedCny: d.used_cny ?? 0,
			})
		} catch (error) {
			Logger.error("getEnterpriseBudget():", error)
			throw error
		}
	}
}
