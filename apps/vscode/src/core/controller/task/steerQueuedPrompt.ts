import { Empty, type StringRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import { Controller } from ".."

/**
 * Promotes a queued prompt to a steering message for the active SDK session.
 *
 * @param controller The controller instance
 * @param request The request containing the queued prompt ID
 * @returns Empty response
 */
export async function steerQueuedPrompt(controller: Controller, request: StringRequest): Promise<Empty> {
	try {
		await controller.steerQueuedPrompt(request.value)
		return Empty.create()
	} catch (error) {
		Logger.error("Error in steerQueuedPrompt handler:", error)
		throw error
	}
}
