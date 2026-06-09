import type { ToolPolicy } from "../llms/tools";
export type AgentMode = "act" | "plan" | "yolo" | "zen";
export type RuntimeConfigExtensionKind =
	| "rules"
	| "skills"
	| "workflows"
	| "plugins";
export declare const RUNTIME_CONFIG_EXTENSION_KINDS: readonly [
	"rules",
	"skills",
	"workflows",
	"plugins",
];
export declare const DEFAULT_RUNTIME_CONFIG_EXTENSIONS: readonly [
	"rules",
	"skills",
	"workflows",
	"plugins",
];
export declare function isRuntimeConfigExtensionKind(
	value: unknown,
): value is RuntimeConfigExtensionKind;
export declare function parseRuntimeConfigExtensions(
	value: unknown,
): RuntimeConfigExtensionKind[] | undefined;
export declare function hasRuntimeConfigExtension(
	extensions: ReadonlyArray<RuntimeConfigExtensionKind> | undefined,
	kind: RuntimeConfigExtensionKind,
): boolean;
export interface SessionPromptConfig {
	mode?: AgentMode;
	systemPrompt?: string;
	rules?: string;
	maxIterations?: number;
}
export interface SessionWorkspaceConfig {
	cwd: string;
	workspaceRoot?: string;
}
export interface SessionExecutionConfig {
	enableTools: boolean;
	teamName?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	maxConsecutiveMistakes?: number;
	toolPolicies?: Record<string, ToolPolicy>;
}
