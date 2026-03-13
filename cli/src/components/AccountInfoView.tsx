/**
 * Account info view component
 * Shows current provider, and for Cline provider: credit balance and organization name
 */

import { Box, Text } from "ink"
import React, { useCallback, useEffect, useState } from "react"
import { Controller } from "@/core/controller"
import { StateManager } from "@/core/storage/StateManager"
import { ClineAccountService } from "@/services/account/ClineAccountService"
import { AuthService } from "@/services/auth/AuthService"
import { LoadingSpinner } from "./Spinner"

interface AccountInfoViewProps {
	controller: Controller
}

/**
 * Capitalize provider name for display
 */
function capitalize(str: string): string {
	return str
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ")
}

/**
 * Format balance as currency (balance is in microcredits, divide by 10000)
 */
function formatBalance(balance: number | null): string {
	if (balance === null || balance === undefined) {
		return "..."
	}
	return `$${(balance / 1000000).toFixed(2)}`
}

export const AccountInfoView: React.FC<AccountInfoViewProps> = React.memo(({ controller }) => {
	const [provider, setProvider] = useState<string | null>(null)
	const [balance, setBalance] = useState<number | null>(null)
	const [email, setEmail] = useState<string | null>(null)
	const [isLoading, setIsLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const fetchAccountInfo = useCallback(async () => {
		try {
			setIsLoading(true)
			setError(null)

			// Get current provider from state
			const stateManager = StateManager.get()
			const mode = stateManager.getGlobalSettingsKey("mode") as string
			const providerKey = mode === "act" ? "actModeApiProvider" : "planModeApiProvider"
			const currentProvider = stateManager.getGlobalSettingsKey(providerKey) as string
			setProvider(currentProvider || "shengsuanyun")

			// If using Cline provider, fetch additional info
			if (currentProvider === "cline") {
				const authService = AuthService.getInstance(controller)

				// Wait for auth to be restored - poll until we have auth info or timeout
				let authInfo = authService.getInfo()
				let attempts = 0
				const maxAttempts = 20 // 2 seconds max
				while (!authInfo?.user?.uid && attempts < maxAttempts) {
					await new Promise((resolve) => setTimeout(resolve, 100))
					authInfo = authService.getInfo()
					attempts++
				}

				// Get user info
				if (authInfo?.user?.email) {
					setEmail(authInfo.user.email)
				} else {
					// User not logged in to Cline
					setEmail(null)
					setIsLoading(false)
					return
				}

				// Fetch credit balance
				try {
					const accountService = ClineAccountService.getInstance()
					const balanceData = await accountService.fetchBalanceRPC()
					if (balanceData?.balance !== undefined) {
						setBalance(balanceData.balance)
					}
				} catch {
					// Balance fetch failed, but we can still show other info
					// Don't log to console as it pollutes CLI output
				}
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "加载账户信息失败")
		} finally {
			setIsLoading(false)
		}
	}, [controller])

	useEffect(() => {
		fetchAccountInfo()
	}, [fetchAccountInfo])

	if (isLoading) {
		return (
			<Box>
				<LoadingSpinner />
				<Text color="gray"> 加载用户信息...</Text>
			</Box>
		)
	}

	if (error) {
		return (
			<Box>
				<Text color="red">错误: {error}</Text>
			</Box>
		)
	}

	// If not using Cline provider, just show the provider name
	if (provider !== "cline") {
		return (
			<Box>
				<Text color="gray">供应商: </Text>
				<Text color="cyan">{capitalize(provider || "Not configured")}</Text>
			</Box>
		)
	}

	// Cline provider but not logged in
	if (!email) {
		return (
			<Box>
				<Text color="gray">供应商: </Text>
				<Text color="cyan">胜算云</Text>
				<Text color="gray"> • </Text>
				<Text color="yellow">未登陆 (运行 'cline auth' 登陆)</Text>
			</Box>
		)
	}

	// Cline provider - show full account info
	return (
		<Box flexDirection="column">
			<Box>
				<Text color="gray">供应商: </Text>
				<Text color="cyan">胜算云</Text>
				{email && (
					<Box>
						<Text color="gray"> • </Text>
						<Text color="white">{email}</Text>
					</Box>
				)}
			</Box>
			<Box>
				<Box>
					<Text color="gray">账户: </Text>
					<Text color="white">Personal</Text>
				</Box>
				<Text color="gray"> • 余额: </Text>
				<Text color="green">{formatBalance(balance)}</Text>
			</Box>
		</Box>
	)
})
