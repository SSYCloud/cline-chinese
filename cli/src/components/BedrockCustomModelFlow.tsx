/**
 * Bedrock Custom Model Flow component
 * Two-step flow: ARN/custom model ID input → base model selection for capability detection.
 * Used by both AuthView (onboarding) and SettingsPanelContent (/settings).
 */

import { Box, Text, useInput } from "ink"
import React, { useCallback, useState } from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { getModelList } from "./ModelPicker"
import { SearchableList } from "./SearchableList"

type FlowStep = "arn_input" | "base_model"

interface BedrockCustomModelFlowProps {
	/** Whether this component should capture keyboard input */
	isActive: boolean
	/** Called when the user completes both steps (ARN + base model selection) */
	onComplete: (arn: string, baseModelId: string) => void
	/** Called when the user presses Escape on the first step (ARN input) */
	onCancel: () => void
}

export const BedrockCustomModelFlow: React.FC<BedrockCustomModelFlowProps> = ({ isActive, onComplete, onCancel }) => {
	const { isRawModeSupported } = useStdinContext()
	const [step, setStep] = useState<FlowStep>("arn_input")
	const [customArn, setCustomArn] = useState("")

	const handleArnSubmit = useCallback(() => {
		if (customArn.trim()) {
			setStep("base_model")
		}
	}, [customArn])

	const handleBaseModelCancel = useCallback(() => {
		setStep("arn_input")
	}, [])

	useInput(
		(input, key) => {
			if (step === "arn_input") {
				if (key.escape) {
					onCancel()
				} else if (key.return) {
					handleArnSubmit()
				} else if (key.backspace || key.delete) {
					setCustomArn((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					setCustomArn((prev) => prev + input)
				}
				return
			}

			if (step === "base_model") {
				if (key.escape) {
					handleBaseModelCancel()
				}
				// Other input is handled by SearchableList
			}
		},
		{ isActive: isActive && isRawModeSupported },
	)

	if (step === "arn_input") {
		return (
			<Box flexDirection="column">
				<Text bold color={COLORS.primaryBlue}>
					自定义模型 ID
				</Text>
				<Box marginTop={1}>
					<Text color="gray">输入您的应用程序推理配置文件 ARN 或自定义模型 ID</Text>
				</Box>
				<Box marginTop={1}>
					{customArn ? (
						<Text color="white">{customArn}</Text>
					) : (
						<Text color="gray">e.g. arn:aws:bedrock:region:account:application-inference-profile/...</Text>
					)}
					<Text inverse> </Text>
				</Box>
				<Box marginTop={1}>
					<Text color="gray">按 Enter 键继续，按 Esc 键返回</Text>
				</Box>
			</Box>
		)
	}

	// step === "base_model"
	return (
		<Box flexDirection="column">
			<Text bold color={COLORS.primaryBlue}>
				基础推理模型
			</Text>
			<Text color="gray">选择推理配置文件使用的基础模型（用于能力检测）</Text>
			<Box marginTop={1}>
				<SearchableList
					isActive={isActive && step === "base_model"}
					items={getModelList("bedrock").map((id) => ({ id, label: id }))}
					onSelect={(item) => {
						onComplete(customArn, item.id)
					}}
				/>
			</Box>
			<Box marginTop={1}>
				<Text color="gray">输入文字进行搜索，使用方向键导航，按 Enter 键选择，按 Esc 键返回。</Text>
			</Box>
		</Box>
	)
}
