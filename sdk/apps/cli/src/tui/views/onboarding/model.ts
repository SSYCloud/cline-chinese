import { isOpenAICodexCliProvider } from "../../../utils/codex-cli";
import { isOAuthProvider } from "../../../utils/provider-auth";

export type OnboardingStep =
	| "menu"
	| "oauth_pending"
	| "device_code"
	| "byo_provider"
	| "byo_apikey"
	| "codex_cli_setup"
	| "cline_model"
	| "model_picker"
	| "custom_model_id"
	| "thinking_level"
	| "done";

export type ThinkingLevel = "none" | "low" | "medium" | "high" | "xhigh";
export type ReasoningEffort = Exclude<ThinkingLevel, "none">;

export const THINKING_LEVELS: {
	value: ThinkingLevel;
	label: string;
	desc: string;
}[] = [
	{ value: "none", label: "Off", desc: "无需深入思考" },
	{ value: "low", label: "Low", desc: "极简推理" },
	{ value: "medium", label: "Medium", desc: "平衡推理" },
	{ value: "high", label: "High", desc: "深度推理" },
	{ value: "xhigh", label: "Extra High", desc: "最大推理" },
];

export interface MenuOption {
	label: string;
	value: string;
	detail: string;
	icon: string;
}

export const MAIN_MENU: MenuOption[] = [
	{
		label: "登录胜算云",
		value: "shengsuanyun",
		detail: "最前沿的模型和功能，推荐使用",
		icon: "\u263a",
	},
	{
		label: "登录 ChatGPT",
		value: "openai-codex",
		detail: "使用您的 ChatGPT Plus 订阅",
		icon: "\u2726",
	},
	{
		label: "自带服务提供商",
		value: "byo",
		detail: "API 密钥或本地服务器（例如 Ollama)",
		icon: "\u26b7",
	},
];

export interface OnboardingResult {
	providerId: string;
	modelId: string;
	apiKey?: string;
	thinking?: boolean;
	reasoningEffort?: ReasoningEffort;
}

export interface ProviderEntry {
	id: string;
	name: string;
	isOAuth: boolean;
	isLocalAuth: boolean;
	hasAuth: boolean;
	capabilities?: readonly string[];
	models: number | null;
	defaultModelId?: string;
}

export interface ModelEntry {
	id: string;
	name: string;
	supportsReasoning: boolean;
}

export interface ProviderCatalogItem {
	id: string;
	name: string;
	apiKey?: string;
	oauthAccessTokenPresent?: boolean;
	capabilities?: readonly string[];
	models: number | null;
	defaultModelId?: string;
}

export interface ProviderModelItem {
	id: string;
	name?: string;
	supportsReasoning?: boolean;
}

export interface KnownModelInfo {
	name?: string;
	capabilities?: string[];
}

export function toProviderEntry(provider: ProviderCatalogItem): ProviderEntry {
	return {
		id: provider.id,
		name: provider.name,
		isOAuth: isOAuthProvider(provider.id),
		isLocalAuth: isOpenAICodexCliProvider(provider.id),
		hasAuth:
			Boolean(provider.apiKey) || provider.oauthAccessTokenPresent === true,
		...(provider.capabilities ? { capabilities: provider.capabilities } : {}),
		models: provider.models,
		defaultModelId: provider.defaultModelId,
	};
}

export function toModelEntry(model: ProviderModelItem): ModelEntry {
	return {
		id: model.id,
		name: model.name || model.id,
		supportsReasoning: model.supportsReasoning === true,
	};
}

export function toModelEntriesFromKnownModels(
	knownModels: Record<string, KnownModelInfo> | undefined,
): ModelEntry[] {
	if (!knownModels) return [];
	return Object.entries(knownModels)
		.map(([id, info]) => ({
			id,
			name: info.name || id,
			supportsReasoning: info.capabilities?.includes("reasoning") ?? false,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export function getOAuthProviderLabel(providerId: string): string {
	if (providerId === "shengsuanyun") {
		return "胜算云";
	}
	if (providerId === "openai-codex") {
		return "ChatGPT";
	}
	return providerId;
}
