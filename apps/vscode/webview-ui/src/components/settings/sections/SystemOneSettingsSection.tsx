import type { ModelInfo } from "@shared/api"
import { DEFAULT_TYPESAFE_MODEL, TYPESAFE_MODELS } from "@shared/typesafe-models"
import { VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { ApiKeyField } from "../common/ApiKeyField"
import Section from "../Section"
import ShengSuanYunModelPicker from "../ShengSuanYunModelPicker"
import { updateSetting } from "../utils/settingsHandlers"

const DEFAULT_TEST_DELETE_THRESHOLD = 0.1
const DEFAULT_CONTEXT_DELETE_THRESHOLD = 0.5
const DEFAULT_TYPESAFE_BASE_URL = "https://router.shengsuanyun.com/api/v1/decisions"

interface ThresholdFieldProps {
	id: string
	label: string
	description: string
	value: number | undefined
	fallback: number
	onCommit: (value: number) => void
}

/** Numeric 0–1 input that commits on blur, clamping out-of-range or invalid text. */
const ThresholdField = ({ id, label, description, value, fallback, onCommit }: ThresholdFieldProps) => {
	const [input, setInput] = useState(String(value ?? fallback))

	useEffect(() => {
		setInput(String(value ?? fallback))
	}, [value, fallback])

	const commit = () => {
		const parsed = Number.parseFloat(input)
		const next = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback
		setInput(String(next))
		onCommit(next)
	}

	return (
		<div className="space-y-1">
			<label htmlFor={id} style={{ fontWeight: 500 }}>
				{label}
			</label>
			<VSCodeTextField
				id={id}
				onBlur={commit}
				onInput={(e) => setInput((e.target as HTMLInputElement)?.value ?? "")}
				placeholder={String(fallback)}
				style={{ width: "100%" }}
				value={input}
			/>
			<p className="text-sm text-(--vscode-descriptionForeground)">{description}</p>
		</div>
	)
}

interface CustomModelNumberFieldProps {
	id: string
	label: string
	placeholder: string
	value: number | undefined
	integer?: boolean
	onCommit: (value: number | undefined) => void
}

/** Optional non-negative number that commits on blur; empty clears the value and invalid text reverts. */
const CustomModelNumberField = ({ id, label, placeholder, value, integer = false, onCommit }: CustomModelNumberFieldProps) => {
	const [input, setInput] = useState(value === undefined ? "" : String(value))

	useEffect(() => {
		setInput(value === undefined ? "" : String(value))
	}, [value])

	const commit = () => {
		const trimmed = input.trim()
		if (trimmed === "") {
			onCommit(undefined)
			return
		}
		const parsed = Number(trimmed)
		const isValid = Number.isFinite(parsed) && parsed >= 0 && (!integer || Number.isInteger(parsed))
		if (!isValid) {
			setInput(value === undefined ? "" : String(value))
			return
		}
		onCommit(parsed)
	}

	return (
		<div className="space-y-1">
			<label htmlFor={id} style={{ fontWeight: 500 }}>
				{label}
			</label>
			<VSCodeTextField
				id={id}
				onBlur={commit}
				onInput={(e) => setInput((e.target as HTMLInputElement)?.value ?? "")}
				placeholder={placeholder}
				style={{ width: "100%" }}
				value={input}
			/>
		</div>
	)
}

interface CustomModelInfoFieldsProps {
	modelId: string
	info: ModelInfo | undefined
}

const CustomModelInfoFields = ({ modelId, info }: CustomModelInfoFieldsProps) => {
	const commit = (patch: Partial<ModelInfo>) => {
		updateSetting("typesafeCustomModelInfo", {
			supportsPromptCache: false,
			...info,
			name: modelId,
			...patch,
		})
	}

	return (
		<div className="space-y-5">
			<CustomModelNumberField
				id="typesafe-custom-input-price"
				integer={false}
				label="输入价格（每百万 tokens）"
				onCommit={(value) => commit({ inputPrice: value })}
				placeholder="例如 0.31"
				value={info?.inputPrice}
			/>
			<CustomModelNumberField
				id="typesafe-custom-output-price"
				integer={false}
				label="输出价格（每百万 tokens）"
				onCommit={(value) => commit({ outputPrice: value })}
				placeholder="例如 1.2"
				value={info?.outputPrice}
			/>
			<CustomModelNumberField
				id="typesafe-custom-context-window"
				integer={true}
				label="上下文大小（tokens）"
				onCommit={(value) => commit({ contextWindow: value })}
				placeholder="例如 128000"
				value={info?.contextWindow}
			/>
			<VSCodeCheckbox
				checked={!!info?.supportsImages}
				onChange={(e: any) => commit({ supportsImages: e.target.checked === true })}>
				支持图片输入
			</VSCodeCheckbox>
		</div>
	)
}

const SystemOneSettingsSection = ({ renderSectionHeader }: { renderSectionHeader?: (tabId: string) => JSX.Element | null }) => {
	const {
		typesafeModel,
		typesafeTestDeleteThreshold,
		typesafeContextDeleteThreshold,
		typesafeBaseUrl,
		typesafeCustomModelInfo,
		typesafeApiKeyAvailable,
		mode,
	} = useExtensionState()

	const selectedModel = typesafeModel?.trim() || DEFAULT_TYPESAFE_MODEL
	const isCustomModel = !TYPESAFE_MODELS[selectedModel]
	const customModelInfo = typesafeCustomModelInfo?.name === selectedModel ? typesafeCustomModelInfo : undefined

	const pickerModels = useMemo<Record<string, ModelInfo>>(() => {
		if (!isCustomModel || !customModelInfo) {
			return TYPESAFE_MODELS
		}
		return { ...TYPESAFE_MODELS, [selectedModel]: customModelInfo }
	}, [isCustomModel, customModelInfo, selectedModel])

	return (
		<div>
			{renderSectionHeader?.("systemone-config")}
			<Section>
				<div className="space-y-1">
					<label htmlFor="typesafe-base-url" style={{ fontWeight: 500 }}>
						决策模型 URL
					</label>
					<VSCodeTextField
						id="typesafe-base-url"
						key={typesafeBaseUrl ?? ""}
						onBlur={(e) => updateSetting("typesafeBaseUrl", (e.target as HTMLInputElement)?.value ?? "")}
						placeholder={DEFAULT_TYPESAFE_BASE_URL}
						style={{ width: "100%" }}
						value={typesafeBaseUrl ?? ""}
					/>
					<p className="text-sm text-(--vscode-descriptionForeground)">留空使用默认地址。</p>
				</div>

				<ApiKeyField
					helpText={
						typesafeApiKeyAvailable ? "已保存决策模型 API Key。留空并保存可清除。" : "未配置时将使用胜算云 API Key。"
					}
					initialValue=""
					label="决策模型 API Key"
					onChange={(value) => updateSetting("typesafeApiKey", value)}
					placeholder={typesafeApiKeyAvailable ? "已保存（输入新值以替换）" : "输入 API 密钥..."}
					providerName="SystemOne"
					signupUrl="https://shengsuanyun.com"
				/>

				<ShengSuanYunModelPicker
					allowCustomModelId
					currentMode={mode}
					inputId="typesafe-model"
					label="决策模型"
					modelId={selectedModel}
					models={pickerModels}
					onModelChange={(value) => updateSetting("typesafeModel", value)}
				/>
				<p className="my-3">使用决策模型筛选上下文。输入列表中没有的模型 ID 后按 Enter 确认。</p>

				{isCustomModel && <CustomModelInfoFields info={customModelInfo} key={selectedModel} modelId={selectedModel} />}

				<ThresholdField
					description="评分低于该值的单元测试会被删除，取值范围 0-1，设为 0 关闭测试整理。"
					fallback={DEFAULT_TEST_DELETE_THRESHOLD}
					id="typesafe-test-delete-threshold"
					label="单元测试删除阀值"
					onCommit={(value) => updateSetting("typesafeTestDeleteThreshold", value)}
					value={typesafeTestDeleteThreshold}
				/>

				<ThresholdField
					description="评分低于该值的上下文工具调用与结果会在压缩时被删除，取值范围 0-1。"
					fallback={DEFAULT_CONTEXT_DELETE_THRESHOLD}
					id="typesafe-context-delete-threshold"
					label="上下文删除阀值"
					onCommit={(value) => updateSetting("typesafeContextDeleteThreshold", value)}
					value={typesafeContextDeleteThreshold}
				/>
			</Section>
		</div>
	)
}

export default SystemOneSettingsSection
