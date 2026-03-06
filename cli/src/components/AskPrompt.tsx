/**
 * User input prompt component
 * Handles different types of user interactions (text input, confirmations, choices)
 */

import type { ClineAsk, ClineMessage } from "@shared/ExtensionMessage"
import { Box, Text, useApp, useInput } from "ink"
import React, { useCallback, useEffect, useRef, useState } from "react"
import { useStdinContext } from "../context/StdinContext"
import { useTaskController } from "../context/TaskContext"
import { useLastCompletedAskMessage } from "../hooks/useStateSubscriber"
import { isMouseEscapeSequence } from "../utils/input"
import { jsonParseSafe } from "../utils/parser"

interface AskPromptProps {
	onRespond?: (response: string) => void
}

type PromptType = "confirmation" | "text" | "options" | "plan_mode_text" | "completion" | "exit_confirmation" | "none"

function getPromptType(ask: ClineAsk, text: string): PromptType {
	switch (ask) {
		case "followup": {
			const parts = jsonParseSafe(text, {
				question: undefined as string | undefined,
				options: undefined as string[] | undefined,
			})
			if (parts.options && parts.options.length > 0) {
				return "options"
			}
			return "text"
		}
		case "plan_mode_respond": {
			const parts = jsonParseSafe(text, {
				question: undefined as string | undefined,
				options: undefined as string[] | undefined,
			})
			if (parts.options && parts.options.length > 0) {
				return "options"
			}
			// Plan mode without options - allow text input or toggle to Act mode
			return "plan_mode_text"
		}
		case "completion_result":
			// Task completed - allow follow-up question or exit
			return "completion"

		case "resume_task":
		case "resume_completed_task":
			return "exit_confirmation"

		case "command":
		case "tool":
		case "browser_action_launch":
		case "use_mcp_server":
			return "confirmation"
		default:
			return "none"
	}
}

export const AskPrompt: React.FC<AskPromptProps> = ({ onRespond }) => {
	const { exit } = useApp()
	const { isRawModeSupported } = useStdinContext()
	const controller = useTaskController()
	const lastAskMessage = useLastCompletedAskMessage()
	const [textInput, setTextInput] = useState("")
	const [responded, setResponded] = useState(false)
	const lastAskTs = useRef<number | null>(null)

	// Reset state when ask message changes
	useEffect(() => {
		if (lastAskMessage && lastAskMessage.ts !== lastAskTs.current) {
			lastAskTs.current = lastAskMessage.ts
			setTextInput("")
			setResponded(false)
		}
	}, [lastAskMessage])

	const sendResponse = useCallback(
		async (responseType: string, text?: string) => {
			if (responded || !controller?.task) {
				return
			}
			setResponded(true)
			try {
				await controller.task.handleWebviewAskResponse(responseType, text)
				onRespond?.(text || responseType)
			} catch {
				// Controller may be disposed
			}
		},
		[controller, responded, onRespond],
	)

	const toggleToActMode = useCallback(async () => {
		if (responded || !controller) {
			return
		}
		setResponded(true)
		try {
			await controller.togglePlanActMode("act")
			onRespond?.("Switched to Act mode")
		} catch {
			// Controller may be disposed
		}
	}, [controller, responded, onRespond])

	// Handle keyboard input
	useInput(
		(input, key) => {
			// Filter out mouse escape sequences
			if (isMouseEscapeSequence(input)) {
				return
			}

			if (!lastAskMessage || responded) {
				return
			}

			const ask = lastAskMessage.ask as ClineAsk
			const text = lastAskMessage.text || ""
			const promptType = getPromptType(ask, text)

			if (promptType === "confirmation" || promptType === "exit_confirmation") {
				// y/n confirmation
				if (input.toLowerCase() === "y") {
					sendResponse("yesButtonClicked")
				} else if (input.toLowerCase() === "n") {
					if (promptType === "exit_confirmation") {
						exit()
						return
					}
					sendResponse("noButtonClicked")
				}
			} else if (promptType === "options") {
				// Number selection for options, or free text input
				const parts = jsonParseSafe(text, { options: [] as string[] })
				if (key.return) {
					// Submit free text on Enter
					if (textInput.trim()) {
						sendResponse("messageResponse", textInput.trim())
					}
				} else if (key.backspace || key.delete) {
					setTextInput((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					// Check if it's a number for option selection (only when no text typed yet)
					const num = Number.parseInt(input, 10)
					if (textInput === "" && !Number.isNaN(num) && num >= 1 && num <= parts.options.length) {
						const selectedOption = parts.options[num - 1]
						sendResponse("messageResponse", selectedOption)
					} else {
						// Regular character input for free text
						setTextInput((prev) => prev + input)
					}
				}
			} else if (promptType === "text") {
				// Text input mode
				if (key.return) {
					// Submit on Enter
					if (textInput.trim()) {
						sendResponse("messageResponse", textInput.trim())
					}
				} else if (key.backspace || key.delete) {
					setTextInput((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					// Regular character input
					setTextInput((prev) => prev + input)
				}
			} else if (promptType === "plan_mode_text") {
				// Plan mode text input - allows text response or toggle to Act mode
				if (key.return) {
					// Submit on Enter
					if (textInput.trim()) {
						sendResponse("messageResponse", textInput.trim())
					} else {
						// Empty enter = switch to Act mode
						toggleToActMode()
					}
				} else if (key.backspace || key.delete) {
					setTextInput((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					// Regular character input
					setTextInput((prev) => prev + input)
				}
			} else if (promptType === "completion") {
				// Task completed - allow follow-up question or exit
				if (key.return) {
					if (textInput.trim()) {
						// Send follow-up question
						sendResponse("messageResponse", textInput.trim())
					} else {
						// Empty enter = confirm completion (exit)
						sendResponse("yesButtonClicked")
					}
				} else if (key.backspace || key.delete) {
					setTextInput((prev) => prev.slice(0, -1))
				} else if (input && !key.ctrl && !key.meta) {
					// Regular character input
					setTextInput((prev) => prev + input)
				}
			}
		},
		{ isActive: isRawModeSupported && !!lastAskMessage && !responded },
	)

	if (!lastAskMessage || responded) {
		return null
	}

	const ask = lastAskMessage.ask as ClineAsk
	const text = lastAskMessage.text || ""
	const promptType = getPromptType(ask, text)
	const icon = getCliMessagePrefixIcon(lastAskMessage)

	if (promptType === "none") {
		return null
	}

	switch (ask) {
		case "followup": {
			const parts = jsonParseSafe(text, {
				question: undefined as string | undefined,
				options: undefined as string[] | undefined,
			})

			if (parts.options && parts.options.length > 0) {
				return (
					<Box flexDirection="column" marginTop={1}>
						<Text color="cyan">选择 (输入数字):</Text>
						{parts.options.map((opt, idx) => (
							<Box key={idx} marginLeft={2}>
								<Text>{`${idx + 1}. ${opt}`}</Text>
							</Box>
						))}
						<Box marginTop={1}>
							<Text>{icon} </Text>
							<Text color="cyan">或输入: </Text>
							<Text>{textInput}</Text>
							<Text inverse> </Text>
						</Box>
						<Text color="gray">(请输入要选择的数字，或输入答案并按 Enter 键。)</Text>
					</Box>
				)
			}

			// Text input prompt
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan">回复: </Text>
						<Text>{textInput}</Text>
						<Text inverse> </Text>
					</Box>
					<Text color="gray">(输入您的回复并按回车键。)</Text>
				</Box>
			)
		}

		case "plan_mode_respond": {
			const parts = jsonParseSafe(text, {
				question: undefined as string | undefined,
				options: undefined as string[] | undefined,
			})

			if (parts.options && parts.options.length > 0) {
				return (
					<Box flexDirection="column" marginTop={1}>
						<Text color="cyan">请选择一个选项（输入数字）:</Text>
						{parts.options.map((opt, idx) => (
							<Box key={idx} marginLeft={2}>
								<Text>{`${idx + 1}. ${opt}`}</Text>
							</Box>
						))}
						<Box marginTop={1}>
							<Text>{icon} </Text>
							<Text color="cyan">或者输入：</Text>
							<Text>{textInput}</Text>
							<Text inverse> </Text>
						</Box>
						<Text color="gray">（请输入数字进行选择，或输入答案并按回车键）</Text>
					</Box>
				)
			}

			// Plan mode text input - show option to switch to Act mode
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan">回复: </Text>
						<Text>{textInput}</Text>
						<Text inverse> </Text>
					</Box>
					<Text color="gray">（输入回复 + 回车，或直接回车即可切换到操作模式）</Text>
				</Box>
			)
		}

		case "command":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="yellow"> 执行此命令？ </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "tool":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="blue"> 使用此工具吗？</Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "completion_result":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan">后续：</Text>
						<Text>{textInput}</Text>
						<Text inverse> </Text>
					</Box>
					<Text color="gray">（输入后续问题并按回车键，或按 q 退出）</Text>
				</Box>
			)

		case "resume_task":
		case "resume_completed_task":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan"> 重启任务? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "browser_action_launch":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan"> 启动浏览器? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		case "use_mcp_server":
			return (
				<Box flexDirection="column" marginTop={1}>
					<Box>
						<Text>{icon} </Text>
						<Text color="cyan"> 使用 MCP? </Text>
						<Text color="gray">(y/n)</Text>
					</Box>
				</Box>
			)

		default:
			return null
	}
}

/**
 * Get emoji icon for message type
 */
function getCliMessagePrefixIcon(message: ClineMessage): string {
	if (message.type === "ask") {
		switch (message.ask) {
			case "followup":
				return "❓"
			case "command":
			case "command_output":
				return "⚙️"
			case "tool":
				return "🔧"
			case "completion_result":
				return "✅"
			case "api_req_failed":
				return "❌"
			case "resume_task":
			case "resume_completed_task":
				return "▶️"
			case "browser_action_launch":
				return "🌐"
			case "use_mcp_server":
				return "🔌"
			case "plan_mode_respond":
				return "📋"
			default:
				return "❔"
		}
	}
	switch (message.say) {
		case "task":
			return "📋"
		case "error":
			return "❌"
		case "text":
			return "💬"
		case "reasoning":
			return "🧠"
		case "completion_result":
			return "✅"
		case "user_feedback":
			return "👤"
		case "command":
		case "command_output":
			return "⚙️"
		case "tool":
			return "🔧"
		case "browser_action":
		case "browser_action_launch":
		case "browser_action_result":
			return "🌐"
		case "mcp_server_request_started":
		case "mcp_server_response":
			return "🔌"
		case "api_req_started":
		case "api_req_finished":
			return "🔄"
		case "checkpoint_created":
			return "💾"
		case "info":
			return "ℹ️"
		case "generate_explanation":
			return "📝"
		default:
			return "  "
	}
}
