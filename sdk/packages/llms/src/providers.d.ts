export {
	type ApiHandler,
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	type BuiltInProviderId,
	type HandlerFactory,
	isBuiltInProviderId,
	type LazyHandlerFactory,
	normalizeProviderId,
	type ProviderCapability,
	type ProviderConfig,
	type ProviderId,
} from "./providers/types";
import { type ApiHandler, type ProviderConfig } from "./providers/types";
export {
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	hasRegisteredHandler,
	isRegisteredHandlerAsync,
	registerAsyncHandler,
	registerHandler,
} from "./providers/factory-registry";
export type {
	ApiStreamChunk,
	ContentBlock,
	FileContent,
	HandlerModelInfo,
	ImageContent,
	Message,
	MessageRole,
	MessageWithMetadata,
	RedactedThinkingContent,
	TextContent,
	ThinkingContent,
	ToolDefinition,
	ToolResultContent,
	ToolUseContent,
} from "./providers/types";
export declare function createHandler(config: ProviderConfig): ApiHandler;
export declare function createHandlerAsync(
	config: ProviderConfig,
): Promise<ApiHandler>;
