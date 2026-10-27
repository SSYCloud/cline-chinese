import { EProjectList } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"
import { clearSsyAuthStateIfUnauthorized } from "./ssyAuthFailure"

export async function getPersonalProjects(controller: Controller, _request: EmptyRequest): Promise<EProjectList> {
	try {
		if (!controller.accountServiceSSY) {
			throw new Error("Account service not available")
		}
		return await controller.accountServiceSSY.getPersonalProjects()
	} catch (error) {
		await clearSsyAuthStateIfUnauthorized(controller, error)
		Logger.error(`Failed to fetch personal projects: ${error}`)
		throw error
	}
}
