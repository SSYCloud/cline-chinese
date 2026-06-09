export declare const CLINE_ENVIRONMENT_ENV = "CLINE_ENVIRONMENT";
export declare const CLINE_ENVIRONMENT_OVERRIDE_ENV =
	"CLINE_ENVIRONMENT_OVERRIDE";
export type ClineEnvironment = "production" | "staging" | "local";
export interface ClineEnvironmentConfig {
	readonly environment: ClineEnvironment;
	readonly appBaseUrl: string;
	readonly apiBaseUrl: string;
	readonly mcpBaseUrl: string;
	readonly workOsClientId: string;
}
export declare const CLINE_ENVIRONMENTS: Readonly<
	Record<ClineEnvironment, ClineEnvironmentConfig>
>;
export declare const DEFAULT_CLINE_ENVIRONMENT: ClineEnvironment;
export interface ResolveClineEnvironmentOptions {
	env?: Partial<NodeJS.ProcessEnv>;
}
export declare function resolveClineEnvironment(
	options?: ResolveClineEnvironmentOptions,
): ClineEnvironment;
export declare function getClineEnvironmentConfig(
	environmentOrOptions?: ClineEnvironment | ResolveClineEnvironmentOptions,
): ClineEnvironmentConfig;
