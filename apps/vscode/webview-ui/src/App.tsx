import type { Boolean, EmptyRequest } from "@shared/proto/cline/common"
import { lazy, Suspense, useCallback, useEffect, useState } from "react"
import ChatView from "./components/chat/ChatView"
import { openClinePassSubscriptionIfPending } from "./components/onboarding/clinePassSubscribe"
import { useClineAuth } from "./context/ClineAuthContext"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { UiServiceClient } from "./services/grpc-client"

// These screens are absent from the normal chat path. Load them on first use,
// while keeping ChatView mounted so drafts and in-flight approvals survive.
const AccountView = lazy(() => import("./components/account/AccountView"))
const HistoryView = lazy(() => import("./components/history/HistoryView"))
const MarketplaceView = lazy(() => import("./components/marketplace/MarketplaceView"))
const McpView = lazy(() => import("./components/mcp/configuration/McpConfigurationView"))
const OnboardingView = lazy(() => import("./components/onboarding/OnboardingView"))
const SettingsView = lazy(() => import("./components/settings/SettingsView"))
const WorktreesView = lazy(() => import("./components/worktrees/WorktreesView"))

const LoadingView = () => <div className="p-4 text-sm text-description">正在加载…</div>

const StartupView = () => {
	const [slow, setSlow] = useState(false)
	useEffect(() => {
		const timer = window.setTimeout(() => setSlow(true), 8000)
		return () => window.clearTimeout(timer)
	}, [])
	return (
		<div className="p-4 text-sm" role="status" style={{ color: "var(--vscode-foreground)" }}>
			<div>正在连接 Cline Chinese…</div>
			{slow && (
				<div className="mt-3" style={{ color: "var(--vscode-descriptionForeground)" }}>
					连接耗时较长。你可以重新加载侧栏；当前任务不会被删除。
					<button
						className="ml-2 underline"
						onClick={() => window.location.reload()}
						style={{ color: "var(--vscode-textLink-foreground)" }}
						type="button">
						重新加载
					</button>
				</div>
			)}
		</div>
	)
}

const AppContent = () => {
	const [skillBotMarket, setSkillBotMarket] = useState(false)
	useEffect(() => {
		const open = () => setSkillBotMarket(true)
		window.addEventListener("loomloom-open-market", open)
		return () => window.removeEventListener("loomloom-open-market", open)
	}, [])
	const {
		didHydrateState,
		showWelcome,
		shouldShowAnnouncement,
		showMarketplace,
		showMcp,
		mcpTab,
		showSettings,
		settingsTargetSection,
		showHistory,
		showAccount,
		showWorktrees,
		showAnnouncement,
		setShowAnnouncement,
		setShouldShowAnnouncement,
		closeMcpView,
		navigateToHistory,
		hideSettings,
		hideHistory,
		hideAccount,
		hideWorktrees,
		closeMarketplaceView,
		hideAnnouncement,
	} = useExtensionState()

	const { clineUser, organizations, activeOrganization } = useClineAuth()

	const showUpdateAnnouncementModal = useCallback(() => {
		setShowAnnouncement(true)
		UiServiceClient.onDidShowAnnouncement({} as EmptyRequest)
			.then((response: Boolean) => {
				setShouldShowAnnouncement(response.value)
			})
			.catch((error) => {
				console.error("Failed to acknowledge announcement:", error)
			})
	}, [setShouldShowAnnouncement, setShowAnnouncement])

	useEffect(() => {
		if (!didHydrateState || showWelcome || !shouldShowAnnouncement || showAnnouncement) {
			return
		}
		showUpdateAnnouncementModal()
	}, [didHydrateState, showWelcome, shouldShowAnnouncement, showAnnouncement, showUpdateAnnouncementModal])

	// Open the ClinePass subscription page once auth completes. Lives here (not in OnboardingView)
	// because handleAuthCallback unmounts onboarding before the clineUser update arrives.
	useEffect(() => {
		if (clineUser?.uid) {
			openClinePassSubscriptionIfPending(clineUser.appBaseUrl)
		}
	}, [clineUser?.uid, clineUser?.appBaseUrl])

	if (!didHydrateState) {
		return <StartupView />
	}

	if (showWelcome) {
		return (
			<Suspense fallback={<LoadingView />}>
				<OnboardingView />
			</Suspense>
		)
	}

	return (
		<div className="flex h-screen w-full flex-col">
			<Suspense fallback={<LoadingView />}>
				{showSettings && <SettingsView onDone={hideSettings} targetSection={settingsTargetSection} />}
				{showHistory && <HistoryView onDone={hideHistory} />}
				{showMarketplace && (
					<MarketplaceView
						initialType={skillBotMarket ? "skillbot" : mcpTab ? "mcp" : undefined}
						onDone={() => {
							setSkillBotMarket(false)
							closeMarketplaceView()
						}}
					/>
				)}
				{showMcp && <McpView initialTab={mcpTab} onDone={closeMcpView} />}
				{showAccount && (
					<AccountView
						activeOrganization={activeOrganization}
						clineUser={clineUser}
						onDone={hideAccount}
						organizations={organizations}
					/>
				)}
				{showWorktrees && <WorktreesView onDone={hideWorktrees} />}
			</Suspense>
			{/* Do not conditionally load ChatView, it's expensive and there's state we don't want to lose (user input, disableInput, askResponse promise, etc.) */}
			<ChatView
				hideAnnouncement={hideAnnouncement}
				isHidden={showSettings || showHistory || showMarketplace || showMcp || showAccount || showWorktrees}
				showAnnouncement={showAnnouncement}
				showHistoryView={navigateToHistory}
			/>
		</div>
	)
}

const App = () => {
	return (
		<Providers>
			<AppContent />
		</Providers>
	)
}

export default App
