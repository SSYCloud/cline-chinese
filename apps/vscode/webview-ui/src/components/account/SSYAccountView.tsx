import type { PaymentTransaction, UsageTransaction } from "@shared/ClineAccount"
import type { EAccount, EnterpriseBillItem, EnterpriseBudget, EPAPIKey, EProject } from "@shared/proto/cline/account"
import { EnterpriseBillRequest, EnterpriseBudgetRequest } from "@shared/proto/cline/account"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import CreditsHistoryTable from "./CreditsHistoryTable"
import EnterpriseBillTable from "./EnterpriseBillTable"
import { StyledCreditDisplaySSY } from "./StyledCreditDisplaySSY"

const formatCny = (n: number) => `¥${n.toFixed(2)}`

type AccountRef = { kind: "personal" } | { kind: "enterprise"; account: EAccount }

interface ProjectTab {
	key: string
	project: EProject
	account: AccountRef
	label: string
}

const BudgetCard = ({ budget }: { budget: EnterpriseBudget }) => {
	const usedPct = budget.totalCny > 0 ? Math.min(100, (budget.usedCny / budget.totalCny) * 100) : 100
	const exhausted = budget.remainingCny <= 0
	return (
		<div className="w-full mb-4 flex flex-col gap-1">
			<div className="flex items-baseline justify-between text-sm">
				<span className="text-(--vscode-descriptionForeground)">
					{budget.budgetKind === "daily" ? "每日额度" : budget.budgetKind === "monthly" ? "每月额度" : "项目额度"}
				</span>
				<span className={exhausted ? "text-(--vscode-errorForeground)" : "text-(--vscode-foreground)"}>
					剩余 {formatCny(budget.remainingCny)} / {formatCny(budget.totalCny)}
				</span>
			</div>
			<div className="h-1.5 w-full rounded bg-(--vscode-progressBar-background)/20 overflow-hidden">
				<div
					className={`h-full ${exhausted ? "bg-(--vscode-errorForeground)" : "bg-(--vscode-progressBar-background)"}`}
					style={{ width: `${usedPct}%` }}
				/>
			</div>
			<div className="text-xs text-(--vscode-descriptionForeground)">
				已用 {formatCny(budget.usedCny)}（剩余 {budget.remainingPercentage.toFixed(0)}%）
				{budget.periodEnd && ` · 重置于 ${new Date(budget.periodEnd).toLocaleString()}`}
			</div>
		</div>
	)
}

const ProjectTabsPanel = ({
	tabs,
	activeKey,
	currentApiKey,
	isSwitchingKey,
	isLoading,
	onSelectTab,
	onSwitchKey,
	onRefresh,
}: {
	tabs: ProjectTab[]
	activeKey: string | undefined
	currentApiKey: string | undefined
	isSwitchingKey: boolean
	isLoading: boolean
	onSelectTab: (key: string) => void
	onSwitchKey: (token: string) => void
	onRefresh: () => void
}) => {
	if (tabs.length === 0) {
		return (
			<div className="flex items-center justify-between gap-2 mb-3">
				<span className="text-xs text-(--vscode-descriptionForeground)">{isLoading ? "加载项目中..." : "暂无项目"}</span>
				<VSCodeButton appearance="icon" onClick={onRefresh}>
					<span className="codicon codicon-refresh" />
				</VSCodeButton>
			</div>
		)
	}
	const activeTab = tabs.find((t) => t.key === activeKey) ?? tabs[0]
	return (
		<div className="flex flex-col gap-2 mb-3">
			<div className="flex items-center gap-1">
				<div className="grow min-w-0 flex gap-1 overflow-x-auto" role="tablist">
					{tabs.map((t) => {
						const selected = t.key === activeTab.key
						return (
							<button
								aria-selected={selected}
								className={`shrink-0 px-2 py-1 text-sm rounded-t border-b-2 cursor-pointer bg-transparent whitespace-nowrap ${
									selected
										? "border-(--vscode-focusBorder) text-(--vscode-foreground) font-medium"
										: "border-transparent text-(--vscode-descriptionForeground) hover:text-(--vscode-foreground)"
								}`}
								key={t.key}
								onClick={() => onSelectTab(t.key)}
								role="tab"
								title={t.label}
								type="button">
								{t.label}
							</button>
						)
					})}
				</div>
				{/* <VSCodeButton appearance="icon" className="shrink-0" onClick={onRefresh}>
					<span className="codicon codicon-refresh" />
				</VSCodeButton> */}
			</div>
			<div className="flex flex-col gap-1" role="tabpanel">
				<span className="text-sm text-(--vscode-descriptionForeground)">API Key：</span>
				{activeTab.project.apiKeys.length === 0 && (
					<span className="text-xs text-(--vscode-descriptionForeground)">该项目下暂无 API Key</span>
				)}
				{activeTab.project.apiKeys.map((k: EPAPIKey) => {
					const isActive = !!k.token && k.token === currentApiKey
					return (
						<div className="flex items-center gap-2 text-sm" key={k.id}>
							<span className="grow min-w-0 truncate" title={k.key}>
								{k.name || k.key}
							</span>
							{isActive ? (
								<VSCodeButton appearance="primary" className="w-26 text-(--vscode-button-foreground)">
									使用中
								</VSCodeButton>
							) : (
								<VSCodeButton
									appearance="secondary"
									className="w-26"
									disabled={isSwitchingKey || k.isExpired || !k.token}
									onClick={() => onSwitchKey(k.token)}>
									{k.isExpired ? "已过期" : "使用"}
								</VSCodeButton>
							)}
						</div>
					)
				})}
			</div>
		</div>
	)
}

export const SSYAccountView = () => {
	const { userInfo, setUserInfo, apiConfiguration } = useExtensionState()
	const [isLoading, setIsLoading] = useState(true)
	const [usageData, setUsageData] = useState<UsageTransaction[]>([])
	const [paymentsData, setPaymentsData] = useState<PaymentTransaction[]>([])
	const [hasLoadedUserData, setHasLoadedUserData] = useState(false)

	// Enterprise state
	const [accounts, setAccounts] = useState<EAccount[]>([])
	const [activeTabKey, setActiveTabKey] = useState<string | null>(null)
	const [personalProjects, setPersonalProjects] = useState<EProject[]>([])
	const [isPersonalProjectsLoading, setIsPersonalProjectsLoading] = useState(false)
	const [enterpriseBills, setEnterpriseBills] = useState<EnterpriseBillItem[]>([])
	const [budget, setBudget] = useState<EnterpriseBudget | null>(null)
	const [isEnterpriseLoading, setIsEnterpriseLoading] = useState(false)
	const [isSwitchingKey, setIsSwitchingKey] = useState(false)

	// All projects from the personal account and every enterprise account, in one tab strip.
	// Keys are namespaced because project ids are only unique within their account.
	const projectTabs = useMemo<ProjectTab[]>(() => {
		// Projects without any API key are not actionable, so they get no tab.
		const hasKeys = (p: EProject) => p.apiKeys.length > 0
		const tabs: ProjectTab[] = personalProjects.filter(hasKeys).map((p) => {
			// The personal project name comes straight from the server (a legacy project
			// may be called "历史项目"), so prefix it to make the account unambiguous.
			// const name = p.name || `项目 ${p.id}`
			return {
				key: `personal:${p.id}`,
				project: p,
				account: { kind: "personal" },
				label: `个人账户`,
			}
		})
		accounts.forEach((account, index) => {
			// Sub-accounts are identified by their own name; main accounts by the enterprise name.
			const prefix = account.enterpriseName || account.name || ""
			account.projects.filter(hasKeys).forEach((p) => {
				const name = p.name || `项目 ${p.id}`
				tabs.push({
					key: `enterprise:${index}:${account.enterpriseId}:${account.ramUserId}:${p.id}`,
					project: p,
					account: { kind: "enterprise", account },
					label: `${prefix}·${name}`,
				})
			})
		})
		return tabs
	}, [personalProjects, accounts])

	const activeTab = projectTabs.find((t) => t.key === activeTabKey) ?? projectTabs[0]
	const activeProject = activeTab?.project
	const activeAccount = activeTab?.account
	const enterpriseAccount = activeAccount?.kind === "enterprise" ? activeAccount.account : undefined
	const isEnterprise = !!enterpriseAccount
	const currentApiKey = apiConfiguration?.shengSuanYunApiKey

	const refreshUserData = useCallback(async () => {
		setIsLoading(true)
		try {
			const res = await AccountServiceClient.shengSuanYunUserData(EmptyRequest.create())
			setUsageData(res.usageTransactions as any)
			setPaymentsData(res.paymentTransactions)
			if (res.user) {
				setUserInfo(res.user)
			}
			setHasLoadedUserData(true)
		} catch (error) {
			console.error("Failed to refresh user credits data:", error)
		} finally {
			setIsLoading(false)
		}
	}, [setUserInfo])

	// Fetch personal account data
	useEffect(() => {
		if (hasLoadedUserData) return
		refreshUserData()
	}, [hasLoadedUserData, refreshUserData])
	useEffect(() => {
		if (!userInfo?.uid) {
			setHasLoadedUserData(false)
			setUsageData([])
			setPaymentsData([])
		}
	}, [userInfo?.uid])

	const fetchPersonalProjects = useCallback(() => {
		setIsPersonalProjectsLoading(true)
		AccountServiceClient.getPersonalProjects(EmptyRequest.create())
			.then((res) => setPersonalProjects(res.projects))
			.catch((error) => console.error("Failed to fetch personal projects:", error))
			.finally(() => setIsPersonalProjectsLoading(false))
	}, [])

	useEffect(() => {
		if (!userInfo?.uid) {
			setPersonalProjects([])
			return
		}
		fetchPersonalProjects()
	}, [userInfo?.uid, fetchPersonalProjects])

	const fetchEnterpriseAccounts = useCallback(() => {
		AccountServiceClient.getEnterpriseAccounts(EmptyRequest.create())
			.then((res) => setAccounts(res.accounts))
			.catch((error) => console.error("Failed to fetch enterprise accounts:", error))
	}, [])

	useEffect(() => {
		fetchEnterpriseAccounts()
	}, [fetchEnterpriseAccounts])

	const fetchEnterpriseBills = useCallback(() => {
		if (!enterpriseAccount) {
			setEnterpriseBills([])
			setBudget(null)
			return
		}
		setIsEnterpriseLoading(true)
		setBudget(null)
		const enterpriseId = enterpriseAccount.enterpriseId
		const ramUserId = enterpriseAccount.ramUserId
		const projectId = activeProject?.id ?? null
		if (projectId !== null) {
			AccountServiceClient.getEnterpriseBudget(EnterpriseBudgetRequest.create({ projectId, enterpriseId, ramUserId }))
				.then((res) => setBudget(res.hasBudget ? res : null))
				.catch((error) => console.error("Failed to fetch enterprise budget:", error))
		}
		const keys = activeProject?.apiKeys ?? []
		Promise.all(
			keys.map((k) =>
				AccountServiceClient.getEnterpriseBill(
					EnterpriseBillRequest.create({
						projectId: projectId ?? 0,
						tokenName: k.name,
						enterpriseId,
						ramUserId,
					}),
				)
					.then((res) => res.bills)
					.catch((error) => {
						console.error(`Failed to fetch usage for API key ${k.name}:`, error)
						return [] as EnterpriseBillItem[]
					}),
			),
		)
			.then((lists) =>
				setEnterpriseBills(lists.flat().sort((a, b) => new Date(b.hourTime).getTime() - new Date(a.hourTime).getTime())),
			)
			.finally(() => setIsEnterpriseLoading(false))
	}, [enterpriseAccount, activeProject])

	// Fetch enterprise bills when the active project changes to an enterprise one
	useEffect(() => {
		if (!isEnterprise) return
		fetchEnterpriseBills()
	}, [isEnterprise, fetchEnterpriseBills])

	const refreshActiveProjects = useCallback(() => {
		if (isEnterprise) {
			fetchEnterpriseBills()
			return
		}
		fetchPersonalProjects()
		if (!activeTab) {
			fetchEnterpriseAccounts()
		}
	}, [isEnterprise, fetchEnterpriseBills, fetchPersonalProjects, fetchEnterpriseAccounts, activeTab])

	const switchApiKey = useCallback((apiKey: string) => {
		setIsSwitchingKey(true)
		AccountServiceClient.switchShengSuanYunApiKey(StringRequest.create({ value: apiKey }))
			.catch((error) => console.error("Failed to switch API key:", error))
			.finally(() => setIsSwitchingKey(false))
	}, [])

	return (
		<div className="h-full flex flex-col">
			{userInfo ? (
				<div className="flex flex-col pr-3 h-full">
					<div className="flex w-full justify-center">
						<div className="flex items-end mb-6 flex-wrap">
							{userInfo.photoUrl ? (
								<img alt="头像" className="size-16 rounded-full mr-4" src={userInfo.photoUrl} />
							) : (
								<div className="size-16 rounded-full bg-(--vscode-button-background) flex items-center justify-center text-2xl text-(--vscode-button-foreground) mr-4">
									{userInfo.displayName?.[0] || userInfo.email?.[0] || "?"}
								</div>
							)}
							<div className="flex flex-col">
								{userInfo.displayName && (
									<h2 className="text-(--vscode-foreground) m-0 mb-1 text-lg font-medium">
										{userInfo.displayName}
									</h2>
								)}
								{userInfo.email && (
									<div className="text-sm text-(--vscode-descriptionForeground)">{userInfo.email}</div>
								)}
								<VSCodeButton
									appearance="secondary"
									className="w-full"
									onClick={() => {
										AccountServiceClient.shengSuanYunLogoutClicked(EmptyRequest.create()).catch((err) =>
											console.error("Failed to logout:", err),
										)
									}}>
									退出登录
								</VSCodeButton>
							</div>
						</div>
					</div>

					<ProjectTabsPanel
						activeKey={activeTab?.key}
						currentApiKey={currentApiKey}
						isLoading={isEnterprise ? isEnterpriseLoading : isPersonalProjectsLoading}
						isSwitchingKey={isSwitchingKey}
						onRefresh={refreshActiveProjects}
						onSelectTab={setActiveTabKey}
						onSwitchKey={switchApiKey}
						tabs={projectTabs}
					/>

					{!isEnterprise && (
						<>
							<VSCodeDivider className="w-full mt-3 mb-4" />
							<div className="w-full flex justify-between items-center">
								{/* <div className="text-sm text-(--vscode-descriptionForeground) mb-3">余额</div> */}
								<div className="text-xl font-bold text-(--vscode-foreground) mb-6 flex items-center gap-2">
									{isLoading ? (
										<div className="text-(--vscode-descriptionForeground)">加载中...</div>
									) : (
										<>
											<span>¥</span>
											<StyledCreditDisplaySSY balance={userInfo.balance || 0} />
											<VSCodeButton appearance="icon" className="mt-1" onClick={refreshUserData}>
												<span className="codicon codicon-refresh" />
											</VSCodeButton>
										</>
									)}
								</div>
								<VSCodeButtonLink
									className="bg-[#f1e83f] text-black"
									href="https://console.shengsuanyun.com/user/recharge">
									首充送10%
								</VSCodeButtonLink>
								{/* <div className="relative mt-3">
								<div className="absolute bottom-full left-1/2 z-10 mb-1 flex -translate-x-1/2 flex-col items-center">
									<div className="whitespace-nowrap rounded-md bg-[#f1e83f] px-2 py-0.5 text-xs font-bold text-black shadow">
										首充送10%
									</div>
									<div className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[#e0a458]" />
								</div>
								<VSCodeButtonLink className="w-full" href="https://console.shengsuanyun.com/user/recharge">
									充值
								</VSCodeButtonLink>
							</div> */}
							</div>
							<VSCodeDivider className="mt-6 mb-3 w-full" />
							<div className="grow flex flex-col min-h-0 pb-0">
								<CreditsHistoryTable isLoading={isLoading} paymentsData={paymentsData} usageData={usageData} />
							</div>
						</>
					)}

					{isEnterprise && enterpriseAccount && (
						<>
							<VSCodeDivider className="w-full mt-3 mb-4" />
							{budget && <BudgetCard budget={budget} />}
							<div className="grow flex flex-col min-h-0 pb-0">
								<EnterpriseBillTable bills={enterpriseBills} isLoading={isEnterpriseLoading} />
							</div>
						</>
					)}
				</div>
			) : null}
		</div>
	)
}
