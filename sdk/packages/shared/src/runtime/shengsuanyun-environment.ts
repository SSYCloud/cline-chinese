export const SHENGSUANYUN_ENVIRONMENT_ENV = "SHENGSUANYUN_ENVIRONMENT";
export const SHENGSUANYUN_ENVIRONMENT_OVERRIDE_ENV = "SHENGSUANYUN_ENVIRONMENT_OVERRIDE";

export type ShengSuanYunEnvironment = "production" | "staging" | "local";

export interface ShengSuanYunEnvironmentConfig {
	readonly environment: ShengSuanYunEnvironment;
	readonly appBaseUrl: string;
	readonly apiBaseUrl: string;
	readonly mcpBaseUrl: string;
	readonly workOsClientId: string;
}

export const SHENGSUANYUN_ENVIRONMENTS: Readonly<
	Record<ShengSuanYunEnvironment, ShengSuanYunEnvironmentConfig>
> = {
	production: {
		environment: "production",
		appBaseUrl: "https://shengsuanyun.com",
		apiBaseUrl: "https://shengsuanyun.com",
		mcpBaseUrl: "",
		workOsClientId: "client_01K3A541FN8TA3EPPHTD2325AR",
	},
	staging: {
		environment: "staging",
		appBaseUrl: "https://staging-app.cline.bot",
		apiBaseUrl: "https://core-api.staging.int.cline.bot",
		mcpBaseUrl: "",
		workOsClientId: "client_01K3A5415VF6QBQBG3XYCW91G6",
	},
	local: {
		environment: "local",
		appBaseUrl: "http://localhost:3000",
		apiBaseUrl: "http://localhost:7777",
		mcpBaseUrl: "http://localhost:7777/v1/mcp",
		workOsClientId: "client_01K6XQAY7JK6T5HXVSZW2S5VYK",
	},
};

export const DEFAULT_SHENGSUANYUN_ENVIRONMENT: ShengSuanYunEnvironment = "production";

export interface ResolveShengSuanYunEnvironmentOptions {
	env?: Partial<NodeJS.ProcessEnv>;
}

function normalizeShengSuanYunEnvironment(
	value: string | undefined,
): ShengSuanYunEnvironment | undefined {
	const normalized = value?.trim().toLowerCase();
	if (
		normalized === "production" ||
		normalized === "staging" ||
		normalized === "local"
	) {
		return normalized;
	}
	return undefined;
}

function readProcessEnv(): NodeJS.ProcessEnv {
	// `process` may be absent in browser-style runtimes (this module ships
	// from the browser entry of `@cline/shared`). Treat its absence as "no
	// env vars set" so callers always get a deterministic default.
	if (typeof process === "undefined" || !process?.env) {
		return {};
	}
	return process.env;
}

export function resolveShengSuanYunEnvironment(
	options: ResolveShengSuanYunEnvironmentOptions = {},
): ShengSuanYunEnvironment {
	const env = options.env ?? readProcessEnv();
	return (
		normalizeShengSuanYunEnvironment(env[SHENGSUANYUN_ENVIRONMENT_OVERRIDE_ENV]) ??
		normalizeShengSuanYunEnvironment(env[SHENGSUANYUN_ENVIRONMENT_ENV]) ??
		DEFAULT_SHENGSUANYUN_ENVIRONMENT
	);
}

export function getShengSuanYunEnvironmentConfig(
	environmentOrOptions?: ShengSuanYunEnvironment | ResolveShengSuanYunEnvironmentOptions,
): ShengSuanYunEnvironmentConfig {
	if (typeof environmentOrOptions === "string") {
		return SHENGSUANYUN_ENVIRONMENTS[environmentOrOptions];
	}
	return SHENGSUANYUN_ENVIRONMENTS[resolveShengSuanYunEnvironment(environmentOrOptions)];
}
