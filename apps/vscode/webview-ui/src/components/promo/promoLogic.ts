import type { TurnState } from "@shared/ExtensionMessage"
import type { BatchChatSnapshot } from "@shared/loomloom"
import { getPromoContent, hasValidPromoContent, type PromoPopupKind } from "./promoContent"

/** Local calendar date key (YYYY-MM-DD) used for the once-per-day rule. */
export function localDateKey(date: Date = new Date()): string {
	const year = date.getFullYear()
	const month = String(date.getMonth() + 1).padStart(2, "0")
	const day = String(date.getDate()).padStart(2, "0")
	return `${year}-${month}-${day}`
}

const BUSY_TURN_PHASES = new Set<TurnState["phase"]>(["streaming", "awaiting_approval", "awaiting_followup"])

/** True while the agent is actively working or waiting on an approval/answer. */
export function isTurnBusy(turnState?: TurnState): boolean {
	return !!turnState && BUSY_TURN_PHASES.has(turnState.phase)
}

/**
 * Batch mode is suppressed entirely: the daily popup promotes Batch, so showing
 * it on top of the Batch editor (or while a batch run is executing) would only
 * get in the way.
 */
export function isBatchInUse(batch?: BatchChatSnapshot): boolean {
	return !!batch?.enabled
}

export interface PromoResolutionInput {
	hydrated: boolean
	showWelcome: boolean
	/** Settings/history/marketplace/account/worktrees or the version "what's new" modal is open. */
	otherOverlayVisible: boolean
	turnState?: TurnState
	batch?: BatchChatSnapshot
	newUserPopupEligible: boolean
	newUserPopupShown: boolean
	dailyPopupEnabled: boolean
	dailyPopupLastShownDate?: string
	/** Local date key for "today"; injected for deterministic tests. */
	today: string
}

/**
 * Decides which promo popup (if any) should auto-show right now.
 *
 * Ordering rules:
 * - Never stack on top of another overlay or an in-progress task.
 * - Within a day the new-user popup has priority; it also consumes that day's
 *   daily slot so the daily popup cannot follow it on the same day.
 * - The daily popup shows at most once per local calendar day and only when
 *   enabled and backed by valid content.
 */
export function resolvePromoPopup(input: PromoResolutionInput): PromoPopupKind | null {
	if (!input.hydrated || input.showWelcome || input.otherOverlayVisible) {
		return null
	}
	if (isTurnBusy(input.turnState) || isBatchInUse(input.batch)) {
		return null
	}

	const newUserContent = getPromoContent("newUser")
	if (input.newUserPopupEligible && !input.newUserPopupShown && hasValidPromoContent(newUserContent)) {
		return "newUser"
	}

	const dailyContent = getPromoContent("daily")
	if (!input.dailyPopupEnabled || !hasValidPromoContent(dailyContent)) {
		return null
	}
	if (input.dailyPopupLastShownDate === input.today) {
		return null
	}

	return "daily"
}
