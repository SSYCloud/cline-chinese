import { UserCreditsData } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { ShengSuanYunAuthError } from "@/sdk/shengsuanyun-account-service"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { clearSsyAuthStateIfUnauthorized } from "./ssyAuthFailure"

export async function shengSuanYunUserData(controller: Controller, _request: EmptyRequest): Promise<UserCreditsData> {
	try {
		if (!controller.accountServiceSSY) {
			throw new Error("Account service not available")
		}
		const userData = await controller.accountServiceSSY.fetchUserDataRPC()
		if (!userData.user?.uid) {
			throw new ShengSuanYunAuthError("胜算云账户信息缺失，请重新登录", 20003)
		}
		controller.stateManager.setGlobalState("userInfo", userData.user)
		return userData
	} catch (error) {
		await clearSsyAuthStateIfUnauthorized(controller, error)
		Logger.error(`Failed to fetch user credits data: ${error}`)
		throw error
	}
}
