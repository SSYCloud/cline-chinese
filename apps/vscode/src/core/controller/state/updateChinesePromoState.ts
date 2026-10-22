import { Empty } from "@shared/proto/cline/common"
import type { UpdateChinesePromoStateRequest } from "@shared/proto/cline/state"
import type { Controller } from ".."

/**
 * Persists Cline Chinese promo-popup bookkeeping (new-user eligibility/consumption,
 * daily popup opt-out and the last local date it was presented).
 *
 * Only fields present in the request are written so the webview can update a
 * single value at a time.
 */
export async function updateChinesePromoState(controller: Controller, request: UpdateChinesePromoStateRequest): Promise<Empty> {
	let changed = false

	if (request.newUserPopupEligible !== undefined) {
		controller.stateManager.setGlobalState("chineseNewUserPopupEligible", !!request.newUserPopupEligible)
		changed = true
	}

	if (request.newUserPopupShown !== undefined) {
		controller.stateManager.setGlobalState("chineseNewUserPopupShown", !!request.newUserPopupShown)
		changed = true
	}

	if (request.dailyPopupEnabled !== undefined) {
		controller.stateManager.setGlobalState("chineseDailyPopupEnabled", !!request.dailyPopupEnabled)
		changed = true
	}

	if (request.dailyPopupLastShownDate !== undefined) {
		controller.stateManager.setGlobalState("chineseDailyPopupLastShownDate", request.dailyPopupLastShownDate || undefined)
		changed = true
	}

	if (changed) {
		await controller.postStateToWebview()
	}

	return Empty.create()
}
