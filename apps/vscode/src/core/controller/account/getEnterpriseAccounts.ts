import { EAccountList } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { clearSsyAuthStateIfUnauthorized } from "./ssyAuthFailure"

export async function getEnterpriseAccounts(controller: Controller, _request: EmptyRequest): Promise<EAccountList> {
	try {
		if (!controller.accountServiceSSY) {
			throw new Error("Account service not available")
		}
		return await controller.accountServiceSSY.getEnterpriseAccounts()
	} catch (error) {
		await clearSsyAuthStateIfUnauthorized(controller, error)
		Logger.error(`Failed to fetch enterprise accounts: ${error}`)
		throw error
	}
}
