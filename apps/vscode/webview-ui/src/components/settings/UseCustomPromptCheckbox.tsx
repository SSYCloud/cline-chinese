import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import React, { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { updateSetting } from "./utils/settingsHandlers"

interface CustomPromptCheckboxProps {
	providerId: string
}

/**
 * Checkbox to enable or disable the use of a compact prompt for local models providers.
 */
const UseCustomPromptCheckbox: React.FC<CustomPromptCheckboxProps> = ({ providerId }) => {
	const { t } = useTranslation("settings")
	const { customPrompt } = useExtensionState()
	const [isCompactPromptEnabled, setIsCompactPromptEnabled] = useState<boolean>(customPrompt === "compact")

	const toggleCompactPrompt = useCallback((isChecked: boolean) => {
		setIsCompactPromptEnabled(isChecked)
		updateSetting("customPrompt", isChecked ? "compact" : "")
	}, [])

	return (
		<div id={providerId}>
			<VSCodeCheckbox checked={isCompactPromptEnabled} onChange={() => toggleCompactPrompt(!isCompactPromptEnabled)}>
				启用提示词压缩
			</VSCodeCheckbox>
			<div className="text-xs text-description">
				针对较小上下文窗口（例如 8k 或更小）优化的系统提示符。
				<div className="text-error flex align-middle">
					<i className="codicon codicon-x" />
					不支持 Mcp 和 Focus Chain
				</div>
			</div>
		</div>
	)
}

export default UseCustomPromptCheckbox
