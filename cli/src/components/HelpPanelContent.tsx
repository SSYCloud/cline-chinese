/**
 * Help panel content for inline display in ChatView
 * Explains Cline CLI features and links to documentation
 */

import { Box, Text, useInput } from "ink"
import React from "react"
import { COLORS } from "../constants/colors"
import { useStdinContext } from "../context/StdinContext"
import { isMouseEscapeSequence } from "../utils/input"
import { Panel } from "./Panel"

interface HelpPanelContentProps {
	onClose: () => void
}

export const HelpPanelContent: React.FC<HelpPanelContentProps> = ({ onClose }) => {
	const { isRawModeSupported } = useStdinContext()

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) {
				return
			}
			if (key.escape) {
				onClose()
			}
		},
		{ isActive: isRawModeSupported },
	)

	return (
		<Panel label="帮助">
			<Box flexDirection="column" gap={1}>
				<Text>Cline 能编辑文件, 运行终端命令, 使用浏览器, 和更多需要您许可的功能。</Text>

				<Box flexDirection="column">
					<Text bold>规划 vs 执行模式</Text>
					<Text>
						使用 <Text color="yellow">规划</Text> 在做出改变之前，可以使用这种模式进行讨论和制定策略。{" "}
						<Text color={COLORS.primaryBlue}>执行</Text> 当您准备好让 Cline 编辑文件和运行命令时，请切换到此模式。使用以下命令在它们之间切换： <Text color="white">Tab</Text>.
					</Text>
				</Box>

				<Box flexDirection="column">
					<Text bold>键盘快捷键</Text>
					<Text>
						{"  "}
						<Text color="white">Ctrl+U</Text> - 清除所有输入（删除开头）
					</Text>
					<Text>
						{"  "}
						<Text color="white">Ctrl+K</Text> - 从光标处删除到末尾
					</Text>
					<Text>
						{"  "}
						<Text color="white">Ctrl+W</Text> - 删除单词（向后）
					</Text>
					<Text>
						{"  "}
						<Text color="white">Ctrl+A / Ctrl+E</Text> - 跳转到输入的开始 / 结束
					</Text>
					<Text>
						{"  "}
						<Text color="white">Alt/Option+←/→</Text> - 按单词移动
					</Text>
				</Box>

				<Box flexDirection="column">
					<Text bold>斜杠命令</Text>
					<Text>
						输入 <Text color="white">/</Text> 查看可用命令。主要命令包括:
					</Text>
					<Text>
						{"  "}
						<Text color="white">/settings</Text> - 配置您的 API 提供商和首选项
					</Text>
					<Text>
						{"  "}
						<Text color="white">/models</Text> - 切换 AI 模型
					</Text>
					<Text>
						{"  "}
						<Text color="white">/history</Text> - 浏览任务历史
					</Text>
					<Text>
						{"  "}
						<Text color="white">/clear</Text> - 开始一项新任务
					</Text>
					<Text>
						{"  "}
						<Text color="white">/q</Text> - 退出 Cline
					</Text>
				</Box>

				<Text>
					如需更多帮助: <Text color={COLORS.primaryBlue}>https://docs.cline.bot/cline-cli</Text>
				</Text>
			</Box>
		</Panel>
	)
}
