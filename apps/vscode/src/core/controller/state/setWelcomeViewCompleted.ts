import type { BooleanRequest } from "@shared/proto/cline/common"
import { Empty } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Sets the welcomeViewCompleted flag to the specified boolean value
 * @param controller The controller instance
 * @param request The boolean request containing the value to set
 * @returns Empty response
 */
export async function setWelcomeViewCompleted(controller: Controller, request: BooleanRequest): Promise<Empty> {
	try {
		// Update the global state to set welcomeViewCompleted to the requested value
		const wasCompleted = !!controller.stateManager.getGlobalStateKey("welcomeViewCompleted")
		controller.stateManager.setGlobalState("welcomeViewCompleted", request.value)

		// Finishing onboarding (as opposed to the upgrade migration, which writes the
		// flag without going through this handler) makes this install eligible for the
		// one-time new-user promo popup. Pre-existing installs are never marked.
		if (request.value && !wasCompleted) {
			controller.stateManager.setGlobalState("chineseNewUserPopupEligible", true)
		}

		await controller.postStateToWebview()

		Logger.log(`Welcome view completed set to: ${request.value}`)
		return Empty.create({})
	} catch (error) {
		Logger.error("Failed to set welcome view completed:", error)
		throw error
	}
}
