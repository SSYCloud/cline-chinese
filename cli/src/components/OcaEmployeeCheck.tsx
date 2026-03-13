/**
 * OCA (Oracle Cloud Assist) employee check component.
 * Shows a checkbox for "I'm an Oracle Employee" and a sign-in button.
 * Sets ocaMode in state before triggering the OAuth flow.
 */

import { Box, Text, useInput } from "ink"
// biome-ignore lint/style/useImportType: React is used as a value by JSX (jsx: "react" in tsconfig)
import React, { useCallback, useState } from "react"
import { StateManager } from "@/core/storage/StateManager"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"

interface OcaEmployeeCheckProps {
	/** Whether this component is active and should handle input */
	isActive: boolean
	/** Called when user confirms and wants to proceed with sign-in */
	onSignIn: () => void
	/** Called when user presses Escape to go back */
	onCancel: () => void
}

export const OcaEmployeeCheck: React.FC<OcaEmployeeCheckProps> = ({ isActive, onSignIn, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()
	const [isEmployee, setIsEmployee] = useState(true) // Default to checked (internal), matching extension behavior
	const [selectedIndex, setSelectedIndex] = useState(0) // 0 = checkbox, 1 = sign in button

	const ITEM_COUNT = 2

	const handleSignIn = useCallback(async () => {
		// Persist ocaMode to state before starting auth
		const stateManager = StateManager.get()
		stateManager.setGlobalState("ocaMode", isEmployee ? "internal" : "external")
		await stateManager.flushPendingState()
		onSignIn()
	}, [isEmployee, onSignIn])

	useInput(
		(_input, key) => {
			if (key.escape) {
				onCancel()
				return
			}
			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : ITEM_COUNT - 1))
			} else if (key.downArrow) {
				setSelectedIndex((prev) => (prev < ITEM_COUNT - 1 ? prev + 1 : 0))
			} else if (key.tab || (key.return && selectedIndex === 0)) {
				// Toggle checkbox when Tab is pressed or Enter on checkbox item
				if (selectedIndex === 0) {
					setIsEmployee((prev) => !prev)
				}
			} else if (key.return && selectedIndex === 1) {
				// Sign in button
				handleSignIn()
			}
		},
		{ isActive: isRawModeSupported && isActive },
	)

	return (
		<Box flexDirection="column">
			<Text color="white">Oracle Code Assist</Text>
			<Text> </Text>
			{/* Checkbox: I'm an Oracle Employee */}
			<Text>
				<Text bold color={selectedIndex === 0 ? COLORS.primaryBlue : undefined}>
					{selectedIndex === 0 ? "❯" : " "}{" "}
				</Text>
				<Text color={selectedIndex === 0 || isEmployee ? COLORS.primaryBlue : "gray"}>{isEmployee ? "[✓]" : "[ ]"}</Text>
				<Text color={selectedIndex === 0 ? COLORS.primaryBlue : "white"}> 我是 Oracle 员工</Text>
				{selectedIndex === 0 && <Text color="gray"> (按 T​​ab 键切换)</Text>}
			</Text>
			{/* Sign in button */}
			<Text>
				<Text bold color={selectedIndex === 1 ? COLORS.primaryBlue : undefined}>
					{selectedIndex === 1 ? "❯" : " "}{" "}
				</Text>
				<Text color={selectedIndex === 1 ? COLORS.primaryBlue : "white"}>使用 Oracle Code Assist 登录</Text>
				{selectedIndex === 1 && <Text color="gray"> (Enter)</Text>}
			</Text>
			<Text> </Text>
			<Text color="gray">请贵公司的 IT 管理员将 Oracle Code Assist 设置为模型提供商。</Text>
			<Text> </Text>
			<Text color="gray">使用方向键导航，Tab 键切换，Enter 键继续，Esc 键返回</Text>
		</Box>
	)
}
