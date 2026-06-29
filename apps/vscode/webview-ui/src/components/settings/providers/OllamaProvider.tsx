import { openAiModelInfoSafeDefaults } from "@shared/api"
import { StringRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useInterval } from "react-use"
import UseCustomPromptCheckbox from "@/components/settings/UseCustomPromptCheckbox"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useProviderConfig } from "@/hooks/useProviderConfig"
import { useProviderModelSelection } from "@/hooks/useProviderModelSelection"
import { ModelsServiceClient } from "@/services/grpc-client"
import { ApiKeyField } from "../common/ApiKeyField"
import { BaseUrlField } from "../common/BaseUrlField"
import { DebouncedTextField } from "../common/DebouncedTextField"
import OllamaModelPicker from "../OllamaModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"
import { useProviderApiKeyField } from "../utils/useProviderApiKeyField"

/**
 * Props for the OllamaProvider component
 */
interface OllamaProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
}

/**
 * The Ollama provider configuration component
 */
export const OllamaProvider = ({ showModelOptions, isPopup, currentMode }: OllamaProviderProps) => {
	const { apiConfiguration } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()
	const { config, write, commitSelection } = useProviderConfig("ollama")

	const [ollamaModels, setOllamaModels] = useState<string[]>([])

	const ollamaBaseUrl = config?.baseUrl ?? apiConfiguration?.ollamaBaseUrl
	const ollamaModelInfo = useMemo(() => {
		const contextWindow = Number.parseInt(apiConfiguration?.ollamaApiOptionsCtxNum || "", 10)
		return {
			...openAiModelInfoSafeDefaults,
			...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
		}
	}, [apiConfiguration?.ollamaApiOptionsCtxNum])
	const ollamaModelInfoById = useMemo(
		() => Object.fromEntries(ollamaModels.map((modelId) => [modelId, { ...ollamaModelInfo, name: modelId }])),
		[ollamaModelInfo, ollamaModels],
	)
	const { selectedModel, commitModelSelection } = useProviderModelSelection("ollama", currentMode, {
		models: ollamaModelInfoById,
		config,
		commitSelection,
		fallbackModelInfo: ollamaModelInfo,
		customModelInfo: (modelId) => ({ ...ollamaModelInfo, name: modelId }),
	})
	const { savedApiKeyMask, handleApiKeyChange } = useProviderApiKeyField({
		apiKeyLength: config?.apiKeyLength,
		providerName: "Ollama",
		write,
	})

	const handleBaseUrlChange = useCallback(
		(value: string) => {
			void write({ baseUrl: value }).catch((error) => console.error("Failed to update Ollama base URL:", error))
		},
		[write],
	)

	// Poll ollama models
	const requestOllamaModels = useCallback(async () => {
		try {
			const response = await ModelsServiceClient.getOllamaModels(
				StringRequest.create({
					value: ollamaBaseUrl || "",
				}),
			)
			if (response && response.values) {
				setOllamaModels(response.values)
			}
		} catch (error) {
			console.error("Failed to fetch Ollama models:", error)
			setOllamaModels([])
		}
	}, [ollamaBaseUrl])

	useEffect(() => {
		requestOllamaModels()
	}, [requestOllamaModels])

	useInterval(requestOllamaModels, 2000)

	return (
		<div className="flex flex-col gap-2">
			<BaseUrlField
				initialValue={ollamaBaseUrl}
				label="使用自定义 URL"
				onChange={handleBaseUrlChange}
				placeholder="Default: http://localhost:11434"
			/>

			{ollamaBaseUrl && (
				<ApiKeyField
					helpText="用于已启用身份验证的 Ollama 实例或云服务的可选 API 密钥。本地安装时请留空。"
					initialValue={savedApiKeyMask}
					onChange={handleApiKeyChange}
					placeholder="Enter API Key (optional)..."
					providerName="Ollama"
				/>
			)}

			{/* Model selection - use filterable picker */}
			<label htmlFor="ollama-model-selection">
				<span className="font-semibold">Model</span>
			</label>
			<OllamaModelPicker
				ollamaModels={ollamaModels}
				onModelChange={(modelId) => {
					const trimmedModelId = modelId.trim()
					if (!trimmedModelId) {
						return
					}
					void commitModelSelection({
						modelId: trimmedModelId,
						modelInfo: { ...ollamaModelInfo, name: trimmedModelId },
					}).catch((error) => console.error("Failed to update Ollama model selection:", error))
				}}
				placeholder={ollamaModels.length > 0 ? "Search and select a model..." : "e.g. llama3.1"}
				selectedModelId={selectedModel.modelId || ""}
			/>

			{/* Show status message based on model availability */}
			{ollamaModels.length === 0 && (
				<p className="text-sm mt-1 text-description italic">
					无法从 Ollama 服务器获取模型。请确保 Ollama 正在运行且可访问，或者在上方手动输入模型 ID。
				</p>
			)}

			<DebouncedTextField
				initialValue={apiConfiguration?.ollamaApiOptionsCtxNum || "32768"}
				onChange={(v) => {
					handleFieldChange("ollamaApiOptionsCtxNum", v || undefined)

					const contextWindow = Number.parseInt(v, 10)
					if (selectedModel.modelId) {
						void commitModelSelection({
							modelId: selectedModel.modelId,
							modelInfo: {
								...openAiModelInfoSafeDefaults,
								name: selectedModel.modelId,
								...(Number.isFinite(contextWindow) && contextWindow > 0 ? { contextWindow } : {}),
							},
						}).catch((error) => console.error("Failed to update Ollama context window:", error))
					}
				}}
				placeholder={"e.g. 32768"}
				style={{ width: "100%" }}>
				<span className="font-semibold">模型上下文窗口</span>
			</DebouncedTextField>

			{showModelOptions && (
				<>
					<DebouncedTextField
						initialValue={apiConfiguration?.requestTimeoutMs ? apiConfiguration.requestTimeoutMs.toString() : "30000"}
						onChange={(value) => {
							// Convert to number, with validation
							const numValue = Number.parseInt(value, 10)
							if (!Number.isNaN(numValue) && numValue > 0) {
								handleFieldChange("requestTimeoutMs", numValue)
							}
						}}
						placeholder="Default: 30000 (30 seconds)"
						style={{ width: "100%" }}>
						<span className="font-semibold">请求超时 (ms)</span>
					</DebouncedTextField>
					<p className="text-xs mt-0 text-description">
						等待 API 响应的最长时长（以毫秒为单位），超过此时间即视为超时。
					</p>
				</>
			)}

			<UseCustomPromptCheckbox providerId="ollama" />

			<p
				style={{
					fontSize: "12px",
					marginTop: "5px",
					color: "var(--vscode-descriptionForeground)",
				}}>
				Ollama 允许您在本地计算机上运行模型。有关如何开始使用的说明，请参阅他们的{" "}
				<VSCodeLink
					href="https://github.com/ollama/ollama/blob/main/README.md"
					style={{ display: "inline", fontSize: "inherit" }}>
					快速入门文档
				</VSCodeLink>{" "}
				<span style={{ color: "var(--vscode-errorForeground)" }}>
					(<span style={{ fontWeight: 500 }}>注意:</span> Cline 使用复杂的提示词，因此不同模型表现出的行为可能会有所差异；能力较弱的模型可能无法达到预期效果。)
				</span>
			</p>
		</div>
	)
}
