import { EmptyRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import ShengSuanYunModelPicker from "../ShengSuanYunModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ShengSuanYunProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

export const ShengSuanYunProvider = ({ showModelOptions, isPopup, currentMode, initialModelTab }: ShengSuanYunProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	return (
		<div>
			<ApiKeyField
				initialValue={apiConfiguration?.shengSuanYunApiKey || ""}
				onChange={(value) => handleFieldChange("shengSuanYunApiKey", value)}
				providerName="胜算云"
				signupUrl="https://console.shengsuanyun.com/user/keys"
			/>
			{showModelOptions && (
				<ShengSuanYunModelPicker currentMode={currentMode} initialModelTab={initialModelTab} isPopup={isPopup} />
			)}
		</div>
	)
}
