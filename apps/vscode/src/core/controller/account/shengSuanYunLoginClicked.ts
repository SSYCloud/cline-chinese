import { ShengSuanYunLoginRequest } from "@shared/proto/cline/account"
import { String } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"
import { Controller } from ".."

export async function shengSuanYunLoginClicked(_controller: Controller, request: ShengSuanYunLoginRequest): Promise<String> {
	const baseUrl = await HostProvider.get().getCallbackUrl("/ssy")
	const callbackUrl = `${baseUrl}`
	const from = request.from || "cline-chinese"
	const authUrl = new URL(`https://router.shengsuanyun.com/auth?from=${from}`)
	authUrl.searchParams.set("callback_url", decodeURIComponent(callbackUrl))
	const authUrlString = authUrl.toString()
	Logger.error("ShengSuanYun login clicked, opening auth URL:", authUrlString)
	await openExternal(authUrlString)
	return String.create({ value: authUrlString })
}
