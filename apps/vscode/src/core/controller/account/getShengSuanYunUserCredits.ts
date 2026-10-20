import { UserCreditsData } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { ShengSuanYunAuthError } from "@/sdk/shengsuanyun-account-service"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

export async function getShengSuanYunUserCredits(controller: Controller, _request: EmptyRequest): Promise<UserCreditsData> {
	try {
		if (!controller.accountServiceSSY) {
			throw new Error("Account service not available")
		}
		return await controller.accountServiceSSY.fetchUserDataRPC()
	} catch (error) {
		if (error instanceof ShengSuanYunAuthError) {
			// Expired/revoked session: drop the credential so sign-in state falls back.
			controller.clearShengSuanYunAuthState()
			await controller.postStateToWebview()
		}
		Logger.error(`Failed to fetch ShengSuanYun user credits data: ${error}`)
		throw error
	}
}
