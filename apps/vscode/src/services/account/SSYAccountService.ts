import { UserCreditsData, UserInfo } from "@shared/proto/cline/account"
import axios, { AxiosRequestConfig } from "axios"
import { Logger } from "@/shared/services/Logger"

export interface QSBills {
    ram_user_id:  number;
    project_id:   number;
    page?:        number;
    page_size?:   number;
    start_time?:  Date;
    end_time?:    Date;
    model_name?:  string;
}

export class SSYAccountService {
	private readonly baseUrl = "https://api.shengsuanyun.com"
	private getSSYApiKey: () => Promise<string | undefined>
	private uid = ""

	constructor(getSSYApiKey: () => Promise<string | undefined>) {
		this.getSSYApiKey = getSSYApiKey
	}
	private async authReq<T>(endpoint: string, config: AxiosRequestConfig = {}): Promise<T> {
		const ssyApiKey = await this.getSSYApiKey()
		const hasToken = config?.headers?.["x-token"]
		if (!ssyApiKey && !hasToken) {
			throw new Error("未找到胜算云 Auth API Key")
		}
		const method = config.method || 'GET'
		const url = `${this.baseUrl}${endpoint}`
		const reqConfig: AxiosRequestConfig = {
			timeout: 50000,
			...config, 
			method,
			url,
			headers: {
				"Content-Type": "application/json",
				...config.headers, 
				"x-token": ssyApiKey || hasToken, 
			},
		}
		try {
			const res = await axios(reqConfig)
			// Logger.log(url, res.data)
			if (!res.data || !res.data.data || res.data.code == 103) {
				throw new Error(`Invalid response from ${endpoint} API`)
			}
			return res.data.data
		} catch (error) {
			Logger.error(`Request failed [${method}] ${url}:`, error)
			throw error;
		}
	}

	async fetchUserDataRPC(): Promise<UserCreditsData> {
		try {
			const dqs = this.dateQueryString()
			let [rate, usage, payment] = await Promise.all([
				this.authReq<any>("/base/rate"),
				this.authReq<any>(`/modelrouter/userlog?page=1&pageSize=1000&${dqs}`),
				this.authReq<any>("/modelrouter/listrecharge?page=1&pageSize=10000"),
			])
			if (!rate) {
				throw new Error(`获取胜算云账户信息失败！`)
			}
			if (!usage || !Array.isArray(usage?.logs)) {
				usage = []
			} else {
				usage = usage.logs.map((it: any) => ({
					spentAt: it.request_time,
					model: `${it.model?.company}/${it.model?.name}`,
					credits: (rate * it.total_amount) / 10000000,
					totalTokens: it.total_amount,
					promptTokens: it.input_tokens,
					completionTokens: it.output_tokens,
				}))
			}

			if (!payment || !Array.isArray(payment.records)) {
				payment = []
			} else {
				payment = payment.records.map((it: any) => ({
					paidAt: it.create_at,
					creatorId: "",
					amountCents: ((rate * it.price) / 10000).toString(),
					credits: 0,
				}))
			}
			Logger.log("UserCreditsData", usage, payment)
			return UserCreditsData.create({
				rate: rate,
				usageTransactions: usage,
				paymentTransactions: payment,
			})
		} catch (error) {
			Logger.error("Failed fetchUserDataRPC:", error)
			throw error
		}
	}

	async getUserInfo(token = ""): Promise<UserInfo> {
		const headers = { ...(token ? { "x-token": token } : {}) }
		try {
			const res = await this.authReq<any>("/user/info", { headers })
			if (!res) {
				Logger.log("getUserInfo response:", res)
				throw new Error(`Invalid response from API: /user/info`)
			}
			this.uid = res.ID || ""
			const user: UserInfo = {
				displayName: res.Nickname || res.Username || undefined,
				email: res.Email ?? undefined,
				photoUrl: res.HeadImg ?? undefined,
				uid: res.ID || undefined,
				balance: res.Wallet.Assets / 10000,
			}
			return user
		} catch (error) {
			Logger.error("getUserInfo():", error)
			Logger.log("headers: ", headers)
			throw error
		}
	}

	async getEProject() {
		try {
			const prjs = await this.authReq("/project/list");
			if (!Array.isArray(prjs)) {
				Logger.log("getEProject response:", prjs);
				throw new Error(`Invalid response from API: /project/list`);
			}
			const apikeys = prjs.map((it: any) => this.authReq("/apikey/list", { method: "POST", data: { project_id: it.id } }));
			const results = await Promise.all(apikeys);
			return prjs.map((it: any, idx: number) => ({
				id: it.id,
				name: it.projectName,
				models: it.selectedModels,
				routers: it.routerConfigs,
				apiKeys: results[idx] || []
			}));

		} catch (error) {           
			Logger.error("getEProject():", error);
			throw error;
		}
	}

	async getEBill(qs:QSBills){
		if(!this.uid || !qs.project_id) {	
			throw new Error("User ID or Project ID is missing for fetching bills")
		}
		const data = {
			...qs,
			raw_user_id: this.uid,
			start_time: qs.start_time ? qs.start_time.toISOString() : new Date().toISOString(),
			end_time: qs.end_time ? qs.end_time.toISOString() : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
		}
		try{
			const bills = await this.authReq<{ bills: any[] }>("/statistics/enterprise/gatewaybill", { method:"POST", data})
			if (!bills || !Array.isArray(bills.bills)) {
				Logger.log("getEBill response:", bills)
				throw new Error(`Invalid response from API: /statistics/enterprise/gatewaybill`)
			}
			return bills.bills
		} catch (error) {			
			Logger.error("getEBill():", error)
			throw error
		}
	}

	dateQueryString(): string {
		const endDate = new Date()
		const startDate = new Date(endDate)
		startDate.setDate(endDate.getDate() - 3)
		const formatDate = (date: Date): string => {
			const year = date.getFullYear()
			const month = String(date.getMonth() + 1).padStart(2, "0") // 月份补零
			const day = String(date.getDate()).padStart(2, "0") // 日期补零
			return `${year}-${month}-${day}`
		}
		return `startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}`
	}

	dateLocal(ds: string): string {
		const dateObj = new Date(ds)
		return dateObj.toLocaleDateString("zh-CN", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		})
	}
}
