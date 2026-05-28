import { ClineMessage } from "@shared/ExtensionMessage"
import { memo } from "react"
import CreditLimitErrorSSY from "@/components/chat/CreditLimitErrorSSY"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSignIn } from "@/context/ShengSuanYunAuthContext"
import { SSYError, SSYErrorType } from "../../../../src/services/error/SSYError"
import { Button } from "@/components/ui/button"

// const _errorColor = "var(--vscode-errorForeground)"

interface ErrorRowProps {
	message: ClineMessage
	errorType: "error" | "mistake_limit_reached" | "diff_error" | "clineignore_error"
	apiRequestFailedMessage?: string
	apiReqStreamingFailedMessage?: string
}

const ErrorRow = memo(({ message, errorType, apiRequestFailedMessage, apiReqStreamingFailedMessage }: ErrorRowProps) => {
	const { userInfo } = useExtensionState()
	const rawApiError = apiRequestFailedMessage || apiReqStreamingFailedMessage
	const { isLoginLoading, handleSignIn } = useSignIn()

	const renderErrorContent = () => {
		switch (errorType) {
			case "error":
			case "mistake_limit_reached":
				// Handle API request errors with special error parsing
				if (rawApiError) {
					// FIXME: ClineError parsing should not be applied to non-Cline providers, but it seems we're using clineErrorMessage below in the default error display
					const ssyError = SSYError.parse(rawApiError)
					const errorMessage = ssyError?._error?.message || ssyError?.message || rawApiError
					const requestId = ssyError?._error?.request_id
					const providerId = ssyError?.providerId || ssyError?._error?.providerId
					const isClineProvider = providerId === "shengsuanyun"
					const errorCode = ssyError?._error?.code

					if (ssyError?.isErrorType(SSYErrorType.Balance)) {
						const errorDetails = ssyError._error?.details
						return (
							<CreditLimitErrorSSY
								buyCreditsUrl={errorDetails?.buy_credits_url}
								currentBalance={errorDetails?.current_balance}
								message={errorDetails?.message}
							/>
						)
					}

						{/* SpendLimit not supported in SSY */}

					if (ssyError?.isErrorType(SSYErrorType.RateLimit)) {
						return (
							<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">
								{errorMessage}
								{requestId && <div>请求 ID: {requestId}</div>}
							</p>
						)
					}

					if (ssyError?.isErrorType(SSYErrorType.QuotaExceeded)) {
						const detailMessage = ssyError?._error?.details?.message || errorMessage
						return <p className="m-0 whitespace-pre-wrap text-error wrap-anywhere">{detailMessage}</p>
					}

					if (ssyError?.isErrorType(SSYErrorType.Auth) && isClineProvider) {
						return !userInfo ? (
							// User is using Cline provider and is not logged in
							<div className="flex flex-col gap-3">
								<div className="flex items-center justify-center rounded border border-neutral-500/30 bg-vscode-editor-background p-6 text-center text-vscode-foreground">
									Whoops looks like you're logged out – click below to sign in
								</div>
								<Button className="w-full" disabled={isLoginLoading} onClick={handleSignIn}>
									Sign in to Cline
									{isLoginLoading && (
										<span className="ml-1 animate-spin">
											<span className="codicon codicon-refresh" />
										</span>
									)}
								</Button>
							</div>
						) : (
							// Don't show sign in button after the user has logged in, just ask them to retry
							<div className="mt-4">
								<span className="text-description">(Click "Retry" below)</span>
							</div>
						)
					}

					return (
						<p className="m-0 whitespace-pre-wrap text-error wrap-anywhere flex flex-col gap-3">
							{/* Display the well-formatted error extracted from the ClineError instance */}

							<header>
								{providerId && <span className="uppercase">[{providerId}] </span>}
								{errorCode && <span>{errorCode}</span>}
								{errorMessage}
								{requestId && <div>请求 ID: {requestId}</div>}
							</header>

							{/* Windows Powershell Issue */}
							{errorMessage?.toLowerCase()?.includes("powershell") && (
								<div>
									看来您遇到了 Windows PowerShell 问题，请参阅此内容。{" "}
									<a
										className="underline text-inherit"
										href="https://github.com/cline/cline/wiki/TroubleShooting-%E2%80%90-%22PowerShell-is-not-recognized-as-an-internal-or-external-command%22">
										故障排除指南
									</a>
									.
								</div>
							)}

							{/* Display raw API error if different from parsed error message */}
							{errorMessage !== rawApiError && <div>{rawApiError}</div>}

							<div className="mt-4">
								<span className="text-description">(Click "Retry" below)</span>
							</div>
						</p>
					)
				}

				// Regular error message
				return <p className="m-0 mt-0 whitespace-pre-wrap text-error wrap-anywhere">{message.text}</p>

			case "diff_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>The model used search patterns that don't match anything in the file. Retrying...</div>
					</div>
				)

			case "clineignore_error":
				return (
					<div className="flex flex-col p-2 rounded text-xs opacity-80 bg-quote text-foreground">
						<div>
							Cline 访问 <code>{message.text}</code> 被 <code>.clineignore</code>配置阻拦
						</div>
					</div>
				)

			default:
				return null
		}
	}

	// For diff_error and clineignore_error, we don't show the header separately
	if (errorType === "diff_error" || errorType === "clineignore_error") {
		return renderErrorContent()
	}

	// For other error types, show header + content
	return renderErrorContent()
})

export default ErrorRow
