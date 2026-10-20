import { type EnterpriseBudget, type EnterpriseBudgetRequest } from "@shared/proto/cline/account"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { clearSsyAuthStateIfUnauthorized } from "./ssyAuthFailure"

export async function getEnterpriseBudget(controller: Controller, request: EnterpriseBudgetRequest): Promise<EnterpriseBudget> {
	try {
		if (!controller.accountServiceSSY) {
			throw new Error("Account service not available")
		}
		return await controller.accountServiceSSY.getEnterpriseBudget(request)
	} catch (error) {
		await clearSsyAuthStateIfUnauthorized(controller, error)
		Logger.error(`Failed to fetch enterprise budget: ${error}`)
		throw error
	}
}
