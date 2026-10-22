import { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { StateServiceClient, UiServiceClient } from "@/services/grpc-client"
import ChinesePromoModal from "./ChinesePromoModal"
import { getPromoContent, OPEN_BATCH_MODE_EVENT, type PromoPopupKind } from "./promoContent"
import { localDateKey, resolvePromoPopup } from "./promoLogic"

// Give the welcome view a moment to decide whether the version "What's New"
// modal is going to open (it waits for the welcome banners to arrive), so the
// two never stack.
const PROMO_SETTLE_DELAY_MS = 600

/**
 * Auto-shows the Cline Chinese new-user popup once after onboarding and the
 * daily popup at most once per local calendar day. Rendered only while the
 * normal chat UI is visible; App gates it behind hydration and the onboarding
 * view.
 */
const ChinesePromoPopup = () => {
	const {
		didHydrateState,
		showWelcome,
		showSettings,
		showHistory,
		showMarketplace,
		showMcp,
		showAccount,
		showWorktrees,
		showWhatsNewModal,
		turnState,
		loomLoomBatch,
		chineseNewUserPopupEligible,
		chineseNewUserPopupShown,
		chineseDailyPopupEnabled,
		chineseDailyPopupLastShownDate,
	} = useExtensionState()

	const [activePopup, setActivePopup] = useState<PromoPopupKind | null>(null)
	const [optOut, setOptOut] = useState(false)
	const [settled, setSettled] = useState(false)
	// One decision per mount, made once the welcome view has settled: after the
	// popup is shown, or deliberately skipped for this entry, later state pushes
	// (a task finishing, a dialog closing) must not open it behind the user's back.
	const attemptedRef = useRef(false)

	useEffect(() => {
		if (!didHydrateState) {
			return
		}
		const timer = setTimeout(() => setSettled(true), PROMO_SETTLE_DELAY_MS)
		return () => clearTimeout(timer)
	}, [didHydrateState])

	// If the version "What's New" modal opens while the promo is up, yield to it
	// instead of stacking two dialogs. The promo slot is already marked consumed.
	useEffect(() => {
		if (activePopup && showWhatsNewModal) {
			setActivePopup(null)
		}
	}, [activePopup, showWhatsNewModal])

	const today = localDateKey()
	const decision = resolvePromoPopup({
		hydrated: didHydrateState && settled,
		showWelcome,
		otherOverlayVisible:
			showSettings || showHistory || showMarketplace || showMcp || showAccount || showWorktrees || showWhatsNewModal,
		turnState,
		batch: loomLoomBatch,
		newUserPopupEligible: !!chineseNewUserPopupEligible,
		newUserPopupShown: !!chineseNewUserPopupShown,
		dailyPopupEnabled: chineseDailyPopupEnabled !== false,
		dailyPopupLastShownDate: chineseDailyPopupLastShownDate,
		today,
	})

	useEffect(() => {
		if (attemptedRef.current || !didHydrateState || !settled) {
			return
		}
		attemptedRef.current = true
		if (!decision || !getPromoContent(decision)) {
			return
		}

		setActivePopup(decision)
		// Mark the slot as consumed as soon as it is presented so a restart or a
		// workspace switch later in the day cannot show it again. The new-user
		// popup also takes that day's daily slot (new-user has priority).
		if (decision === "newUser") {
			StateServiceClient.updateChinesePromoState({
				newUserPopupShown: true,
				dailyPopupLastShownDate: today,
			}).catch((error) => console.error("Failed to record new-user popup:", error))
		} else {
			StateServiceClient.updateChinesePromoState({
				dailyPopupLastShownDate: today,
			}).catch((error) => console.error("Failed to record daily popup:", error))
		}
	}, [didHydrateState, settled, decision, today])

	const close = useCallback(() => {
		if (activePopup === "daily" && optOut) {
			StateServiceClient.updateChinesePromoState({ dailyPopupEnabled: false }).catch((error) =>
				console.error("Failed to disable daily popup:", error),
			)
		}
		setActivePopup(null)
	}, [activePopup, optOut])

	if (!activePopup) {
		return null
	}

	const content = getPromoContent(activePopup)
	if (!content) {
		return null
	}

	const openExternal = (url: string) => {
		UiServiceClient.openUrl({ value: url }).catch((error) => console.error("Failed to open URL:", error))
	}

	const handlePrimary = () => {
		if (content.primaryAction.type === "batch") {
			window.dispatchEvent(new Event(OPEN_BATCH_MODE_EVENT))
		} else {
			openExternal(content.primaryAction.url)
		}
		close()
	}

	const handleSecondary = () => {
		if (content.secondaryUrl) {
			openExternal(content.secondaryUrl)
		}
		close()
	}

	return (
		<ChinesePromoModal
			content={content}
			kind={activePopup}
			onClose={close}
			onOptOutChange={setOptOut}
			onPrimary={handlePrimary}
			onSecondary={content.secondaryLabel && content.secondaryUrl ? handleSecondary : undefined}
			optOut={optOut}
		/>
	)
}

export default ChinesePromoPopup
