import type { PaymentTransaction, UsageTransaction } from "@shared/ClineAccount"
import type { EAccount, EnterpriseBillItem, EnterpriseBudget } from "@shared/proto/cline/account"
import { EnterpriseBillRequest, EnterpriseBudgetRequest } from "@shared/proto/cline/account"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton, VSCodeDivider, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useState } from "react"
import ClineLogoPanda from "@/assets/ClineLogoPanda"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import VSCodeButtonLink from "../common/VSCodeButtonLink"
import CreditsHistoryTable from "./CreditsHistoryTable"
import EnterpriseBillTable from "./EnterpriseBillTable"
import { StyledCreditDisplaySSY } from "./StyledCreditDisplaySSY"

const PERSONAL = "personal"

const formatCny = (n: number) => `¥${n.toFixed(2)}`

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

export const SSYAccountView = () => {
	const { userInfo, setUserInfo, apiConfiguration } = useExtensionState()
	const [isLoading, setIsLoading] = useState(true)
	const [usageData, setUsageData] = useState<UsageTransaction[]>([])
	const [paymentsData, setPaymentsData] = useState<PaymentTransaction[]>([])
	const [hasLoadedUserData, setHasLoadedUserData] = useState(false)

	// Enterprise state
	const [accounts, setAccounts] = useState<EAccount[]>([])
	const [selectedAccount, setSelectedAccount] = useState<string>(PERSONAL)
	const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null)
	const [enterpriseBills, setEnterpriseBills] = useState<EnterpriseBillItem[]>([])
	const [budget, setBudget] = useState<EnterpriseBudget | null>(null)
	const [isEnterpriseLoading, setIsEnterpriseLoading] = useState(false)
	const [isSwitchingKey, setIsSwitchingKey] = useState(false)

	const isEnterprise = selectedAccount !== PERSONAL
	const enterpriseAccount: EAccount | undefined = isEnterprise ? accounts[Number(selectedAccount)] : undefined
	const selectedProject = enterpriseAccount?.projects.find((p) => p.id === selectedProjectId)
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

	// Fetch associated enterprise accounts
	useEffect(() => {
		AccountServiceClient.getEnterpriseAccounts(EmptyRequest.create())
			.then((res) => setAccounts(res.accounts))
			.catch((error) => console.error("Failed to fetch enterprise accounts:", error))
	}, [])

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
		if (selectedProjectId !== null) {
			AccountServiceClient.getEnterpriseBudget(
				EnterpriseBudgetRequest.create({ projectId: selectedProjectId, enterpriseId, ramUserId }),
			)
				.then((res) => setBudget(res.hasBudget ? res : null))
				.catch((error) => console.error("Failed to fetch enterprise budget:", error))
		}
		const keys = selectedProject?.apiKeys ?? []
		Promise.all(
			keys.map((k) =>
				AccountServiceClient.getEnterpriseBill(
					EnterpriseBillRequest.create({
						projectId: selectedProjectId ?? 0,
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
	}, [enterpriseAccount, selectedProject, selectedProjectId])

	// Fetch enterprise bills when account / project changes
	useEffect(() => {
		if (!isEnterprise) return
		fetchEnterpriseBills()
	}, [isEnterprise, fetchEnterpriseBills])

	const switchApiKey = useCallback((apiKey: string) => {
		setIsSwitchingKey(true)
		AccountServiceClient.switchShengSuanYunApiKey(StringRequest.create({ value: apiKey }))
			.catch((error) => console.error("Failed to switch API key:", error))
			.finally(() => setIsSwitchingKey(false))
	}, [])

	if (!userInfo?.uid) {
		return (
			<div className="flex flex-col items-center pr-3">
				<ClineLogoPanda className="size-16 mb-4" />
				<p style={{}}>注册帐户访问最新模型，进群联系客服，获得100万Tokens免费额度，以及更多即将推出的功能。</p>
				<VSCodeButton
					className="w-full mb-4"
					onClick={() => {
						setIsLoading(true)
						AccountServiceClient.shengSuanYunLoginClicked(EmptyRequest.create())
							.catch((err) => console.error("Failed to get login URL:", err))
							.finally(() => setIsLoading(false))
					}}>
					注册 Cline 胜算云
				</VSCodeButton>
				<p className="text-(--vscode-descriptionForeground) text-xs text-center m-0">
					继续即表示您同意{" "}
					<VSCodeLink href="https://docs.router.shengsuanyun.com/terms-of-service">服务条款</VSCodeLink> 和{" "}
					<VSCodeLink href="https://docs.router.shengsuanyun.com/privacy-policy">隐私政策.</VSCodeLink>
				</p>
			</div>
		)
	}

	return (
		<div className="h-full flex flex-col">
			<div className="flex flex-col pr-3 h-full">
				<div className="flex flex-col w-full">
					<div className="flex items-center mb-6 flex-wrap gap-y-4 mt-4">
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
						</div>
					</div>
				</div>

				<div className="w-full flex gap-2 flex-col min-[225px]:flex-row">
					{accounts.length > 0 && (
						<select
							className="grow min-w-0 bg-(--vscode-button-background) text-(--vscode-button-foreground) border border-(--vscode-dropdown-border) rounded px-2 py-1 text-sm"
							onChange={(e) => {
								const value = e.target.value
								setSelectedAccount(value)
								if (value !== PERSONAL) {
									setSelectedProjectId(accounts[Number(value)]?.projects[0]?.id ?? null)
								} else {
									switchApiKey("")
								}
							}}
							value={selectedAccount}>
							<option value={PERSONAL}>个人账户</option>
							{accounts.map((a, idx) => (
								<option key={`${a.userId}-${a.ramUserId}`} value={String(idx)}>
									{a.enterpriseName || a.name}
									{a.accountType === "sub" ? `（${a.name}）` : "（主账号）"}
								</option>
							))}
						</select>
					)}
					<VSCodeButton
						appearance="secondary"
						className="w-full min-[225px]:w-1/2"
						onClick={() => {
							AccountServiceClient.shengSuanYunLogoutClicked(EmptyRequest.create()).catch((err) =>
								console.error("Failed to logout:", err),
							)
						}}>
						退出登录
					</VSCodeButton>
				</div>

				<VSCodeDivider className="w-full my-4" />
				{!isEnterprise && (
					<>
						<div className="w-full flex flex-col items-center">
							<div className="text-sm text-(--vscode-descriptionForeground) mb-3">余额</div>
							<div className="text-3xl font-bold text-(--vscode-foreground) mb-6 flex items-center gap-2">
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
							<div className="w-full relative mt-3">
								<div className="absolute bottom-full left-1/2 z-10 mb-1 flex -translate-x-1/2 flex-col items-center">
									<div className="whitespace-nowrap rounded-md bg-[#f1e83f] px-2 py-0.5 text-xs font-bold text-black shadow">
										首充送10%
									</div>
									<div className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-[#e0a458]" />
								</div>
								<VSCodeButtonLink className="w-full" href="https://console.shengsuanyun.com/user/recharge">
									充值
								</VSCodeButtonLink>
							</div>
							{accounts.length > 0 && (
								<VSCodeButton
									appearance="secondary"
									className="w-full mt-3"
									disabled={isSwitchingKey}
									onClick={() => switchApiKey("")}>
									使用个人账户 API Key
								</VSCodeButton>
							)}
						</div>
						<VSCodeDivider className="mt-6 mb-3 w-full" />
						<div className="grow flex flex-col min-h-0 pb-0">
							<CreditsHistoryTable isLoading={isLoading} paymentsData={paymentsData} usageData={usageData} />
						</div>
					</>
				)}

				{isEnterprise && enterpriseAccount && (
					<>
						<div className="flex flex-col gap-2 mb-3">
							{enterpriseAccount.projects.length > 0 && (
								<div className="flex items-center gap-2">
									<span className="text-sm text-(--vscode-descriptionForeground) shrink-0">项目：</span>
									<select
										className="grow min-w-0 bg-(--vscode-button-background) text-(--vscode-button-foreground) border border-(--vscode-dropdown-border) rounded px-2 py-1 text-sm"
										onChange={(e) => setSelectedProjectId(Number(e.target.value))}
										value={selectedProjectId ?? ""}>
										{enterpriseAccount.projects.map((p) => (
											<option key={p.id} value={p.id}>
												{p.name}
											</option>
										))}
									</select>
									<VSCodeButton appearance="icon" onClick={fetchEnterpriseBills}>
										<span className="codicon codicon-refresh" />
									</VSCodeButton>
								</div>
							)}
							{selectedProject && (
								<div className="flex flex-col gap-1">
									<span className="text-sm text-(--vscode-descriptionForeground)">API Key：</span>
									{selectedProject.apiKeys.length === 0 && (
										<span className="text-xs text-(--vscode-descriptionForeground)">
											该项目下暂无 API Key
										</span>
									)}
									{selectedProject.apiKeys.map((k) => {
										const isActive = !!k.token && k.token === currentApiKey
										return (
											<div className="flex items-center gap-2 text-sm" key={k.id}>
												<span className="grow min-w-0 truncate">{k.name || k.key}</span>
												{isActive ? (
													<VSCodeButton
														appearance="primary"
														className="w-22 text-(--vscode-button-foreground)">
														使用中
													</VSCodeButton>
												) : (
													<VSCodeButton
														appearance="secondary"
														className="w-22"
														disabled={isSwitchingKey || k.isExpired || !k.token}
														onClick={() => switchApiKey(k.token)}>
														{k.isExpired ? "已过期" : "使用"}
													</VSCodeButton>
												)}
											</div>
										)
									})}
								</div>
							)}
						</div>
						{budget && <BudgetCard budget={budget} />}
						<div className="grow flex flex-col min-h-0 pb-0">
							<EnterpriseBillTable bills={enterpriseBills} isLoading={isEnterpriseLoading} />
						</div>
					</>
				)}
			</div>
		</div>
	)
}
