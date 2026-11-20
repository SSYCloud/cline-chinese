import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import ClineLogoPanda from "@/assets/ClineLogoPanda"
import { ClineAuthStatus } from "./ClineAuthStatus"

export type AccountType = "cline" | "ssy"

export const ACCOUNT_LABELS: Record<AccountType, string> = {
	cline: "Cline",
	ssy: "胜算云",
}

type AccountLoginPromptProps = {
	account: AccountType
	isLoading: boolean
	statusMessage: string | null
	onSignIn: () => void
}

export const AccountLoginPrompt = ({ account, isLoading, statusMessage, onSignIn }: AccountLoginPromptProps) => {
	const label = ACCOUNT_LABELS[account]

	return (
		<div className="flex flex-col items-center gap-2.5">
			<ClineLogoPanda className="size-16 mb-4" />
			<p>登录{label}账户后，即可查看该账户的数据。</p>
			<VSCodeButton className="w-full mb-4" disabled={isLoading} onClick={onSignIn}>
				登录 {label}
				{isLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</VSCodeButton>
			{account === "cline" && <ClineAuthStatus message={statusMessage} />}
		</div>
	)
}
