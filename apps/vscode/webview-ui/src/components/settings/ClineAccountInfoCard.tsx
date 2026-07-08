import { StringRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useState } from "react"
import { ClineAuthStatus } from "@/components/account/ClineAuthStatus"
import { useClineSignIn } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

export const ClineAccountInfoCard = ({ usageLink }: { usageLink?: string }) => {
	// const { clineUser } = useClineAuth()
	const { navigateToAccount } = useExtensionState()
	const { isLoginLoading, authStatusMessage, handleSignIn } = useClineSignIn()
	const [didStartLogin, setDidStartLogin] = useState(false)

	const user = undefined

	const handleLogin = () => {
		setDidStartLogin(true)
		handleSignIn()
	}

	useEffect(() => {
		if (didStartLogin && user) {
			navigateToAccount()
		}
	}, [didStartLogin, navigateToAccount, user])

	const handleShowAccount = () => {
		if (!usageLink) {
			return navigateToAccount()
		}

		UiServiceClient.openUrl(StringRequest.create({ value: usageLink })).catch((err) => {
			console.error("Failed to open usage link:", err)
		})
	}

	return (
		<div className="max-w-[600px]">
			{user ? (
				<VSCodeButton appearance="secondary" onClick={handleShowAccount}>
					查看充值 & 使用记录
				</VSCodeButton>
			) : (
				<div className="flex flex-col gap-3">
					<VSCodeButton className="mt-0" disabled={isLoginLoading} onClick={handleLogin}>
						Sign Up with Cline
						{isLoginLoading && (
							<span className="ml-1 animate-spin">
								<span className="codicon codicon-refresh" />
							</span>
						)}
					</VSCodeButton>
					<ClineAuthStatus message={authStatusMessage} />
				</div>
			)}
		</div>
	)
}
