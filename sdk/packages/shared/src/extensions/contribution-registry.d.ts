import type { AgentRuntimeHooks, AgentTool } from "../agent";
import type { AutomationEventEnvelope } from "../cron";
import type { BasicLogger } from "../logging/logger";
import type { ITelemetryService } from "../services/telemetry";
import type { WorkspaceInfo } from "../session/workspace";
import type { ClientContext, UserContext } from "./context";
export interface AgentExtensionCommand {
	name: string;
	description?: string;
	handler?: (input: string) => Promise<string> | string;
}
export interface AgentExtensionRule {
	id: string;
	content: string | (() => string | Promise<string>);
	source?: string;
}
export interface AgentExtensionMessageBuilder<TMessage = unknown> {
	name: string;
	build: (message: TMessage) => TMessage | Promise<TMessage>;
}
export interface AgentExtensionProvider {
	name: string;
	description?: string;
	metadata?: Record<string, unknown>;
}
export interface AgentExtensionAutomationEventType {
	/** Normalized event type a plugin can emit, e.g. `github.pull_request.opened`. */
	eventType: string;
	/** Normalized source identifier, e.g. `github`, `linear`, or `local`. */
	source: string;
	description?: string;
	attributesSchema?: Record<string, unknown>;
	payloadSchema?: Record<string, unknown>;
	examples?: AutomationEventEnvelope[];
	metadata?: Record<string, unknown>;
}
export interface AgentExtensionAutomationContext {
	/**
	 * Submit a normalized automation event to the host. Raw webhook or connector
	 * payloads should be translated into an `AutomationEventEnvelope` first.
	 */
	ingestEvent: (event: AutomationEventEnvelope) => void | Promise<void>;
}
export interface AgentExtensionSessionContext {
	/** Stable core session id for the root session that loaded the plugin. */
	sessionId?: string;
}
/**
 * API surface passed to an extension's `setup()` method.
 *
 * Use it to register the contributions the extension wants to make — tools,
 * commands, message builders, providers, and automation event types. All
 * registrations accumulate into the `ContributionRegistry` and are available to
 * the host after `setup()` completes.
 */
export interface AgentExtensionApi<TTool = AgentTool, TMessage = unknown> {
	/** Register a tool the agent can invoke during its run. Requires the `tools` capability. */
	registerTool: (tool: TTool) => void;
	/** Register a slash command available in connected chat surfaces. Requires the `commands` capability. */
	registerCommand: (command: AgentExtensionCommand) => void;
	/** Register prompt rules included in the runtime system prompt. Requires the `rules` capability. */
	registerRule: (rule: AgentExtensionRule) => void;
	/** Register a named message builder for transforming messages before they are sent. Requires the `messageBuilders` capability. */
	registerMessageBuilder: (
		builder: AgentExtensionMessageBuilder<TMessage>,
	) => void;
	/** Register a provider contribution (e.g. a custom model provider). Requires the `providers` capability. */
	registerProvider: (provider: AgentExtensionProvider) => void;
	/** Register a normalized automation event type the plugin can emit. Requires the `automationEvents` capability. */
	registerAutomationEventType: (
		eventType: AgentExtensionAutomationEventType,
	) => void;
}
export type AgentExtensionHooks = Partial<AgentRuntimeHooks>;
/**
 * Session-scoped workspace context passed as the second argument to an
 * extension's `setup(api, ctx)` method.
 *
 * These values are always sourced from the host session config — never from
 * `process.cwd()`. Use them to resolve paths or build workspace-aware tool
 * schemas at registration time.
 *
 * All fields are optional so `setup()` callers that do not have host context
 * (e.g. unit tests) can omit them without breaking plugins.
 */
export interface PluginSetupContext {
	/**
	 * Core session metadata known before the first agent run starts.
	 * Agent-level ids such as `agentId` and `conversationId` are available on
	 * lifecycle hook contexts once SessionRuntime creates them.
	 */
	session?: AgentExtensionSessionContext;
	/** Host/client identity such as `cline-cli`, `cline-vscode`, or an SDK app. */
	client?: ClientContext;
	/** Authenticated user or organization identity when the host provides it. */
	user?: UserContext;
	/**
	 * Structured workspace and git metadata for the session. Contains
	 * `rootPath`, `hint`, `associatedRemoteUrls`, `latestGitCommitHash`, and
	 * `latestGitBranchName`. Use `rootPath` for workspace-relative paths and
	 * the git fields for branch-aware registration or commit attribution at
	 * setup time.
	 */
	workspaceInfo?: WorkspaceInfo;
	/**
	 * Automation ingress made available by hosts that enable ClineCore
	 * automation. Plugins should feature-detect this property so the same plugin
	 * can run in hosts that do not enable automation.
	 */
	automation?: AgentExtensionAutomationContext;
	/** Host-provided logger scoped to this session/plugin setup. */
	logger?: BasicLogger;
	/**
	 * Host-provided telemetry service when available in the current process.
	 *
	 * This service is intentionally not serialized across plugin sandbox process
	 * boundaries; sandboxed plugins should feature-detect this property and expect
	 * it to be undefined unless a future host adds an explicit telemetry bridge.
	 */
	telemetry?: ITelemetryService;
}
declare const ExtensionCapabilityOptions: readonly [
	"hooks",
	"tools",
	"commands",
	"rules",
	"skills",
	"messageBuilders",
	"providers",
	"automationEvents",
];
export type AgentExtensionCapability =
	(typeof ExtensionCapabilityOptions)[number];
export interface PluginManifest {
	paths?: string[];
	capabilities: AgentExtensionCapability[];
	providerIds?: string[];
	modelIds?: string[];
}
export interface AgentExtensionRegistry<TTool = AgentTool, TMessage = unknown> {
	tools: TTool[];
	commands: AgentExtensionCommand[];
	rules: AgentExtensionRule[];
	messageBuilder: AgentExtensionMessageBuilder<TMessage>[];
	providers: AgentExtensionProvider[];
	automationEventTypes: AgentExtensionAutomationEventType[];
}
/**
 * Base shape for a plugin or extension that can be loaded into a
 * `ContributionRegistry`.
 *
 * An extension declares what it does through its `manifest` (capabilities and
 * hook stages) and implements the corresponding handler methods. The registry
 * validates at setup time that every declared stage has a matching handler and
 * that no undeclared handlers are present.
 *
 * Hook handler properties are typed `unknown` here so that the generic base
 * interface stays free of agent-specific imports. Concrete extension types
 * (e.g. `AgentExtension` in `@coohu/agents`) narrow them to the correct
 * context and return types.
 */
export interface ContributionRegistryExtension<
	TTool = AgentTool,
	TMessage = unknown,
> {
	type?: string;
	/** Unique identifier for this extension, used in error messages and hook handler names. */
	name: string;
	/** Declares what capabilities and hook stages this extension uses. Validated before `setup()` runs. */
	manifest: PluginManifest;
	/** Indicates whether this extension is disabled. Disabled extensions are ignored during setup. */
	disabled?: boolean;
	/** Runtime-native hooks consumed directly by `@coohu/agents`. */
	hooks?: AgentExtensionHooks;
	/**
	 * Called once during registry setup to register tools, commands, and other
	 * contributions.
	 *
	 * The optional second argument provides workspace context that is always
	 * sourced from the host session config — never from `process.cwd()`. Use
	 * `ctx.workspaceInfo?.rootPath` instead of `process.cwd()` or
	 * `import.meta.url` tricks when you need workspace-relative paths.
	 */
	setup?: (
		api: AgentExtensionApi<TTool, TMessage>,
		ctx: PluginSetupContext,
	) => void | Promise<void>;
}
export interface ContributionRegistryOptions<
	TExtension extends ContributionRegistryExtension<TTool, TMessage>,
	TTool = AgentTool,
	TMessage = unknown,
> {
	extensions?: TExtension[];
	/** Workspace context forwarded to each extension's `setup(api, ctx)` call. */
	setupContext?: PluginSetupContext;
}
export declare function normalizePluginManifest(
	manifest: PluginManifest,
): PluginManifest;
export declare class ContributionRegistry<
	TExtension extends ContributionRegistryExtension<TTool, TMessage>,
	TTool = AgentTool,
	TMessage = unknown,
> {
	private readonly extensions;
	private readonly registry;
	private normalized;
	private phase;
	private readonly setupContext;
	constructor(
		options?: ContributionRegistryOptions<TExtension, TTool, TMessage>,
	);
	resolve(): void;
	validate(): void;
	setup(): Promise<void>;
	activate(): void;
	initialize(): Promise<void>;
	isActivated(): boolean;
	getRegistrySnapshot(): AgentExtensionRegistry<TTool, TMessage>;
	getRegisteredTools(): TTool[];
	getRegisteredRules(): AgentExtensionRule[];
	getRegisteredAutomationEventTypes(): AgentExtensionAutomationEventType[];
	getValidatedExtensions(): TExtension[];
}
export declare function createContributionRegistry<
	TExtension extends ContributionRegistryExtension<TTool, TMessage>,
	TTool = AgentTool,
	TMessage = unknown,
>(
	options?: ContributionRegistryOptions<TExtension, TTool, TMessage>,
): ContributionRegistry<TExtension, TTool, TMessage>;
export {};
