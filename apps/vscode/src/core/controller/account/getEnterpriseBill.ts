import { EnterpriseBillRequest, EnterpriseBillResponse } from "@shared/proto/cline/account"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { clearSsyAuthStateIfUnauthorized } from "./ssyAuthFailure"

export async function getEnterpriseBill(controller: Controller, request: EnterpriseBillRequest): Promise<EnterpriseBillResponse> {
	try {
		if (!controller.accountServiceSSY) {
			throw new Error("Account service not available")
		}
		return await controller.accountServiceSSY.getEnterpriseBill(request)
	} catch (error) {
		await clearSsyAuthStateIfUnauthorized(controller, error)
		Logger.error(`Failed to fetch enterprise bill: ${error}`)
		throw error
	}
}
