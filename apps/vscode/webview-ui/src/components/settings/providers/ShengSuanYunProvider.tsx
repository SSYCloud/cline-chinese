import type { EAccount } from "@shared/proto/cline/account"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import { Mode } from "@shared/storage/types"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useMemo, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useSignIn as useShengSuanYunSignIn } from "@/context/ShengSuanYunAuthContext"
import { AccountServiceClient } from "@/services/grpc-client"
import { ApiKeyField, type ApiKeyFieldOption } from "../common/ApiKeyField"
import ShengSuanYunModelPicker from "../ShengSuanYunModelPicker"
import { useApiConfigurationHandlers } from "../utils/useApiConfigurationHandlers"

interface ShengSuanYunProviderProps {
	showModelOptions: boolean
	isPopup?: boolean
	currentMode: Mode
	initialModelTab?: "recommended" | "free"
}

const LoginBtn = () => {
	const { isLoginLoading, handleSignIn } = useShengSuanYunSignIn()

	return (
		<div className="mt-2 flex flex-col items-center gap-2">
			<VSCodeButton appearance="primary" className="w-full" disabled={isLoginLoading} onClick={handleSignIn}>
				登录胜算云
				{isLoginLoading && (
					<span className="ml-1 animate-spin">
						<span className="codicon codicon-refresh" />
					</span>
				)}
			</VSCodeButton>
			<span className="text-xs text-(--vscode-descriptionForeground)">登录后将自动同步 API Key。</span>
		</div>
	)
}

/**
 * Flattens the enterprise accounts into a selectable list of API keys.
 * Keys without a token cannot be used for requests, so they are skipped.
 */
const toEnterpriseApiKeyOptions = (accounts: EAccount[]): ApiKeyFieldOption[] => {
	const options: ApiKeyFieldOption[] = []
	accounts.forEach((account) => {
		const accountName = account.enterpriseName || account.name || `企业 ${account.enterpriseId}`
		account.projects.forEach((project) => {
			const projectName = project.name || `项目 ${project.id}`
			project.apiKeys.forEach((key) => {
				if (!key.token) {
					return
				}
				const keyName = key.name || key.key || `Key ${key.id}`
				const unavailable = key.isExpired || key.isBanned
				const suffix = key.isBanned ? "（已禁用）" : key.isExpired ? "（已过期）" : ""
				options.push({
					id: `${account.enterpriseId}:${account.ramUserId}:${project.id}:${key.id}`,
					label: `${accountName} / ${projectName} / ${keyName}${suffix}`,
					value: key.token,
					disabled: unavailable,
				})
			})
		})
	})
	return options
}

export const ShengSuanYunProvider = ({ showModelOptions, isPopup, currentMode, initialModelTab }: ShengSuanYunProviderProps) => {
	const { apiConfiguration, userInfo } = useExtensionState()
	const { handleFieldChange } = useApiConfigurationHandlers()

	const [enterpriseAccounts, setEnterpriseAccounts] = useState<EAccount[]>([])
	const [isLoadingKeys, setIsLoadingKeys] = useState(false)
	const [isSwitchingKey, setIsSwitchingKey] = useState(false)
	const [keysError, setKeysError] = useState<string | null>(null)

	const currentApiKey = apiConfiguration?.shengSuanYunApiKey || ""
	const isLoggedIn = !!userInfo?.uid

	useEffect(() => {
		if (!isLoggedIn) {
			setEnterpriseAccounts([])
			setKeysError(null)
			return
		}
		let cancelled = false
		setIsLoadingKeys(true)
		setKeysError(null)
		AccountServiceClient.getEnterpriseAccounts(EmptyRequest.create())
			.then((res) => {
				if (!cancelled) {
					setEnterpriseAccounts(res.accounts)
				}
			})
			.catch((error) => {
				console.error("Failed to fetch enterprise accounts:", error)
				if (!cancelled) {
					setKeysError("获取企业账户 API Key 失败")
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoadingKeys(false)
				}
			})
		return () => {
			cancelled = true
		}
	}, [isLoggedIn])

	const enterpriseKeyOptions = useMemo(() => toEnterpriseApiKeyOptions(enterpriseAccounts), [enterpriseAccounts])

	// The picker only knows the personal key (empty value restores the remembered
	// personal key) and the listed enterprise keys, so a hand-typed key falls
	// back to showing the personal option.
	const selectedEnterpriseKey = enterpriseKeyOptions.find((option) => option.value === currentApiKey)

	const handleSelectKey = async (value: string) => {
		if (value === currentApiKey || !isLoggedIn) {
			return
		}
		// Switching back to the personal key requires a key to already be set;
		// the controller restores the remembered personal key (or the current one).
		if (!value && !currentApiKey) {
			return
		}
		setIsSwitchingKey(true)
		setKeysError(null)
		try {
			await AccountServiceClient.switchShengSuanYunApiKey(StringRequest.create({ value }))
		} catch (error) {
			console.error("Failed to switch ShengSuanYun API key:", error)
			setKeysError(`切换 API Key 失败：${error instanceof Error ? error.message : String(error)}`)
		} finally {
			setIsSwitchingKey(false)
		}
	}

	const keyPickerOptions = [...enterpriseKeyOptions]
	if (currentApiKey && keyPickerOptions.length > 0) {
		keyPickerOptions.unshift({ id: "personal", label: "个人账户 API Key", value: "" })
	}

	const keyOptions = isLoggedIn
		? {
				options: keyPickerOptions,
				value: selectedEnterpriseKey?.value ?? "",
				disabled: isSwitchingKey,
				loading: isLoadingKeys,
				loadingText: "正在加载企业账户 API Key...",
				error: keysError,
				hint: enterpriseKeyOptions.length > 0 ? "可从已关联的企业账户 API Key 中快速切换。" : undefined,
				onSelect: (value: string) => {
					void handleSelectKey(value)
				},
			}
		: undefined

	return (
		<div>
			<ApiKeyField
				initialValue={currentApiKey}
				keyOptions={keyOptions}
				loginBtn={userInfo?.uid ? undefined : <LoginBtn />}
				onChange={(value) => handleFieldChange("shengSuanYunApiKey", value)}
				providerName="胜算云"
				signupUrl="https://console.shengsuanyun.com/user/keys/?from=cline-chinese"
			/>
			{showModelOptions && (
				<ShengSuanYunModelPicker currentMode={currentMode} initialModelTab={initialModelTab} isPopup={isPopup} />
			)}
		</div>
	)
}
