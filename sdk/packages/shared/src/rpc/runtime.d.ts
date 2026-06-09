import z from "zod";
import type { HubToolExecutorName } from "../hub";
import type {
	RuntimeConfigExtensionKind,
	SessionExecutionConfig,
	SessionPromptConfig,
} from "../session/runtime-config";
export interface ChatRuntimeConfig extends SessionPromptConfig {
	cwd?: string;
	apiKey?: string;
	logger?: RuntimeLoggerConfig;
	enableTools: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	disableMcpSettingsTools?: boolean;
	autoApproveTools?: boolean;
	missionStepInterval?: number;
	missionTimeIntervalMs?: number;
	timeoutSeconds?: number;
	toolPolicies?: SessionExecutionConfig["toolPolicies"];
	toolExecutors?: HubToolExecutorName[];
	configExtensions?: RuntimeConfigExtensionKind[];
}
export interface RuntimeLoggerConfig {
	enabled?: boolean;
	level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";
	destination?: string;
	name?: string;
	bindings?: Record<string, string | number | boolean>;
}
export interface ChatStartSessionRequest extends ChatRuntimeConfig {
	sessionId?: string;
	workspaceRoot: string;
	provider: string;
	model: string;
	source?: string;
	interactive?: boolean;
}
export interface ChatStartSessionArtifacts {
	sessionId: string;
	manifestPath: string;
	messagesPath: string;
}
export interface ChatStartSessionResponse {
	sessionId: string;
	startResult?: ChatStartSessionArtifacts;
}
export interface ChatAttachmentFile {
	name: string;
	content: string;
}
export interface ChatAttachments {
	userImages?: string[];
	userFiles?: ChatAttachmentFile[];
}
export interface ChatRunTurnRequest {
	config: ChatStartSessionRequest;
	prompt: string;
	attachments?: ChatAttachments;
	delivery?: "queue" | "steer";
}
export interface ChatToolCallResult {
	name: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	durationMs?: number;
}
export interface ChatTurnResult {
	text: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	};
	inputTokens: number;
	outputTokens: number;
	iterations: number;
	finishReason: string;
	toolCalls: ChatToolCallResult[];
}
export interface EnterpriseContext {
	projectId?: string;
	workspaceId?: string;
	organizationId?: string;
}
export interface EnterpriseAuthenticateRequest extends EnterpriseContext {
	providerId: string;
	workspacePath: string;
	rootPath?: string;
}
export interface EnterpriseAuthenticateResponse {
	providerId: string;
	authenticated: boolean;
	roles: string[];
	claims?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}
export interface EnterpriseSyncRequest extends EnterpriseContext {
	providerId: string;
	workspacePath: string;
	rootPath?: string;
	useCachedBundle?: boolean;
}
export interface EnterpriseSyncResponse {
	providerId: string;
	authenticated: boolean;
	hasCachedBundle: boolean;
	appliedConfigVersion?: string;
	roles: string[];
	hasTelemetryOverrides: boolean;
	rulesCount: number;
	workflowsCount: number;
	skillsCount: number;
	claims?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}
export interface EnterpriseStatusRequest {
	providerId: string;
	workspacePath: string;
	rootPath?: string;
}
export type EnterpriseStatusResponse = EnterpriseSyncResponse;
export interface ProviderModel {
	id: string;
	name: string;
	supportsAttachments?: boolean;
	supportsVision?: boolean;
	supportsReasoning?: boolean;
}
export type ProviderConfigFieldType =
	| "text"
	| "password"
	| "url"
	| "number"
	| "select"
	| "boolean";
export type ProviderConfigFieldPrimitive = string | number | boolean | null;
export interface ProviderConfigFieldOption {
	label: string;
	value: Exclude<ProviderConfigFieldPrimitive, null>;
}
export interface ProviderConfigField {
	path: string;
	label: string;
	type: ProviderConfigFieldType;
	description?: string;
	placeholder?: string;
	required?: boolean;
	secret?: boolean;
	options?: ProviderConfigFieldOption[];
	defaultValue?: ProviderConfigFieldPrimitive;
}
export interface ProviderListItem {
	id: string;
	name: string;
	models: number | null;
	color: string;
	letter: string;
	enabled: boolean;
	apiKey?: string;
	oauthAccessTokenPresent?: boolean;
	baseUrl?: string;
	defaultModelId?: string;
	protocol?: ProviderProtocol;
	client?: ProviderClient;
	capabilities?: ProviderCapability[];
	authDescription: string;
	baseUrlDescription: string;
	configFields?: ProviderConfigField[];
	configValues?: Record<string, ProviderConfigFieldPrimitive>;
	modelList?: ProviderModel[];
	family?: string;
}
export interface ProviderCatalogResponse {
	providers: ProviderListItem[];
	settingsPath: string;
}
export interface ProviderModelsResponse {
	providerId: string;
	models: ProviderModel[];
}
import type { OAuthProviderId } from "../types/auth";
export declare const ProviderCapabilitySchema: z.ZodEnum<{
	tools: "tools";
	streaming: "streaming";
	"prompt-cache": "prompt-cache";
	reasoning: "reasoning";
	"computer-use": "computer-use";
	temperature: "temperature";
	files: "files";
	"provider-tools": "provider-tools";
	oauth: "oauth";
	vision: "vision";
	"local-auth": "local-auth";
	popular: "popular";
}>;
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;
export declare const ProviderProtocolSchema: z.ZodEnum<{
	"openai-responses": "openai-responses";
	anthropic: "anthropic";
	gemini: "gemini";
	"openai-chat": "openai-chat";
	"openai-r1": "openai-r1";
	"ai-sdk": "ai-sdk";
}>;
export type ProviderProtocol = z.infer<typeof ProviderProtocolSchema>;
export declare const ProviderClientSchema: z.ZodEnum<{
	custom: "custom";
	anthropic: "anthropic";
	gemini: "gemini";
	"openai-r1": "openai-r1";
	"ai-sdk": "ai-sdk";
	"ai-sdk-community": "ai-sdk-community";
	openai: "openai";
	"openai-compatible": "openai-compatible";
	bedrock: "bedrock";
	fetch: "fetch";
	vertex: "vertex";
}>;
export type ProviderClient = z.infer<typeof ProviderClientSchema>;
export interface ListProvidersActionRequest {
	action: "listProviders";
}
export interface GetProviderModelsActionRequest {
	action: "getProviderModels";
	providerId: string;
}
export interface SaveProviderSettingsActionRequest {
	action: "saveProviderSettings";
	providerId: string;
	enabled?: boolean;
	apiKey?: string;
	auth?: {
		apiKey?: string;
		accessToken?: string;
		refreshToken?: string;
		expiresAt?: number;
		accountId?: string;
	};
	model?: string;
	protocol?: ProviderProtocol;
	client?: ProviderClient;
	routingProviderId?: string;
	maxTokens?: number;
	contextWindow?: number;
	baseUrl?: string;
	headers?: Record<string, string>;
	timeout?: number;
	reasoning?: {
		enabled?: boolean;
		effort?: "none" | "low" | "medium" | "high" | "xhigh";
		budgetTokens?: number;
	};
	aws?: {
		accessKey?: string;
		secretKey?: string;
		sessionToken?: string;
		region?: string;
		profile?: string;
		authentication?: "iam" | "api-key" | "apikey" | "profile";
		usePromptCache?: boolean;
		useCrossRegionInference?: boolean;
		useGlobalInference?: boolean;
		endpoint?: string;
		customModelBaseId?: string;
	};
	gcp?: {
		projectId?: string;
		region?: string;
	};
	azure?: {
		apiVersion?: string;
		useIdentity?: boolean;
	};
	sap?: {
		clientId?: string;
		clientSecret?: string;
		tokenUrl?: string;
		resourceGroup?: string;
		deploymentId?: string;
		useOrchestrationMode?: boolean;
		api?: "orchestration" | "foundation-models";
		defaultSettings?: Record<string, unknown>;
	};
	oca?: {
		mode?: "internal" | "external";
		usePromptCache?: boolean;
	};
	region?: string;
	apiLine?: "china" | "international";
	capabilities?: (
		| "reasoning"
		| "prompt-cache"
		| "streaming"
		| "tools"
		| "vision"
		| "computer-use"
		| "oauth"
	)[];
}
export interface AddProviderActionRequest {
	action: "addProvider";
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models?: string[];
	defaultModelId?: string;
	modelsSourceUrl?: string;
	protocol?: ProviderProtocol;
	client?: ProviderClient;
	capabilities?: ProviderCapability[];
}
export type ProviderSettingsActionRequest =
	| ListProvidersActionRequest
	| GetProviderModelsActionRequest
	| SaveProviderSettingsActionRequest
	| AddProviderActionRequest;
export type ClineAccountActionRequest =
	| {
			action: "clineAccount";
			operation: "fetchMe";
	  }
	| {
			action: "clineAccount";
			operation: "fetchBalance";
			userId?: string;
	  }
	| {
			action: "clineAccount";
			operation: "fetchUsageTransactions";
			userId?: string;
	  }
	| {
			action: "clineAccount";
			operation: "fetchPaymentTransactions";
			userId?: string;
	  }
	| {
			action: "clineAccount";
			operation: "fetchUserOrganizations";
	  }
	| {
			action: "clineAccount";
			operation: "fetchOrganizationBalance";
			organizationId: string;
	  }
	| {
			action: "clineAccount";
			operation: "fetchOrganizationUsageTransactions";
			organizationId: string;
			memberId?: string;
	  }
	| {
			action: "clineAccount";
			operation: "switchAccount";
			organizationId?: string | null;
	  }
	| {
			action: "clineAccount";
			operation: "fetchFeaturebaseToken";
	  };
export type ProviderActionRequest =
	| ProviderSettingsActionRequest
	| ClineAccountActionRequest;
export interface ProviderOAuthLoginResponse {
	provider: OAuthProviderId;
	accessToken: string;
}
