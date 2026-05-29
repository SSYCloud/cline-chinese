import { createInterface } from "node:readline";
import {
	BUILT_IN_PROVIDER,
	createOAuthClientCallbacks,
	ensureCustomProvidersLoaded,
	listLocalProviders,
	type ProviderSettings,
	type ProviderSettingsManager,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import { Command } from "commander";
import open from "open";
import React from "react";
import { disableOpenTuiGraphicsProbe } from "../tui/opentui-env";
import {
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeAuthProviderId,
	normalizeProviderId,
	type OAuthCredentials,
	toProviderApiKey,
} from "../utils/provider-auth";

export {
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeAuthProviderId,
	normalizeProviderId,
	toProviderApiKey,
};
export type { OAuthCredentials };

const c = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
};

type CoreOAuthApi = {
	loginClineOAuth: (input: {
		apiBaseUrl: string;
		useWorkOSDeviceAuth?: boolean;
		callbacks: {
			onAuth: (info: { url: string; instructions?: string }) => void;
			onPrompt: (prompt: {
				message: string;
				defaultValue?: string;
			}) => Promise<string>;
			onManualCodeInput?: () => Promise<string>;
		};
	}) => Promise<OAuthCredentials>;
	loginOcaOAuth: (input: {
		mode?: "internal" | "external";
		callbacks: {
			onAuth: (info: { url: string; instructions?: string }) => void;
			onPrompt: (prompt: {
				message: string;
				defaultValue?: string;
			}) => Promise<string>;
			onManualCodeInput?: () => Promise<string>;
		};
	}) => Promise<OAuthCredentials>;
	loginOpenAICodex: (input: {
		onAuth: (info: { url: string; instructions?: string }) => void;
		onPrompt: (prompt: {
			message: string;
			defaultValue?: string;
		}) => Promise<string>;
		onManualCodeInput?: () => Promise<string>;
	}) => Promise<OAuthCredentials>;
};

type AuthIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type AuthQuickSetupInput = {
	provider: string;
	apikey: string;
	modelid: string;
	baseurl?: string;
};

type AuthCommandInput = {
	providerSettingsManager: ProviderSettingsManager;
	io: AuthIo;
	explicitProvider?: string;
	apikey?: string;
	modelid?: string;
	baseurl?: string;
};

type ParsedAuthCommandArgs = {
	explicitProvider?: string;
	apikey?: string;
	modelid?: string;
	baseurl?: string;
	parseError?: string;
};

let cachedCoreOAuthApi: Promise<CoreOAuthApi> | undefined;

async function getCoreOAuthApi(): Promise<CoreOAuthApi> {
	if (!cachedCoreOAuthApi) {
		cachedCoreOAuthApi = import("@cline/core").then((module) => {
			const runtimeApi = module as Partial<CoreOAuthApi>;
			if (
				typeof runtimeApi.loginClineOAuth !== "function" ||
				typeof runtimeApi.loginOcaOAuth !== "function" ||
				typeof runtimeApi.loginOpenAICodex !== "function"
			) {
				throw new Error(
					"已安装的 @cline/core 未暴露 CLI 所需的 OAuth 登录辅助函数。",
				);
			}
			return runtimeApi as CoreOAuthApi;
		});
	}
	return cachedCoreOAuthApi;
}

/**
 * Create the `auth` subcommand for Commander.
 *
 * In the auth context, `-p` means `--provider` and `-m` means `--modelid`,
 * which intentionally shadows the global `-p` (--plan) and `-m` (--model)
 * short flags. Commander scopes options per-command, so there is no conflict.
 */
export function createAuthCommand(): Command {
	const cmd = new Command("auth")
		.description("向 LLM 提供商进行身份验证")
		.exitOverride()
		.configureOutput({ writeOut: () => {}, writeErr: () => {} })
		.argument("[provider]", "供应商 id (-p 简写)")
		.option("-p, --provider <id>", "供应商 id")
		.option("-k, --apikey <key>", "API key")
		.option("-m, --modelid <id>", "模型 id")
		.option("-b, --baseurl <url>", "base URL");
	return cmd;
}

export function parseAuthCommandArgs(args: string[]): ParsedAuthCommandArgs {
	const cmd = createAuthCommand();
	try {
		cmd.parse(args, { from: "user" });
	} catch {
		// Commander throws on --help / --version / unknown flags via exitOverride
		return { parseError: `unknown auth option in: ${args.join(" ")}` };
	}
	const opts = cmd.opts<{
		provider?: string;
		apikey?: string;
		modelid?: string;
		baseurl?: string;
	}>();
	const positionalProvider = cmd.args[0];
	return {
		explicitProvider: opts.provider ?? positionalProvider,
		apikey: opts.apikey,
		modelid: opts.modelid,
		baseurl: opts.baseurl,
	};
}

async function loadProviderCatalog(
	providerSettingsManager: ProviderSettingsManager,
): Promise<Array<{ id: string; name: string }>> {
	await ensureCustomProvidersLoaded(providerSettingsManager);
	const catalog = await listLocalProviders(providerSettingsManager);
	return catalog.providers
		.map((provider) => ({
			id: provider.id.trim(),
			name: provider.name.trim() || provider.id.trim(),
		}))
		.filter((provider) => provider.id.length > 0)
		.sort((a, b) => a.id.localeCompare(b.id));
}

async function ensureQuickSetupInputValid(
	input: AuthQuickSetupInput,
	providerSettingsManager: ProviderSettingsManager,
): Promise<string | undefined> {
	const normalizedProvider = normalizeProviderId(input.provider);
	const providerCatalog = await loadProviderCatalog(providerSettingsManager);
	if (!providerCatalog.some((provider) => provider.id === normalizedProvider)) {
		return `invalid provider "${input.provider}"`;
	}
	if (!input.apikey.trim()) {
		return "auth quick setup requires --apikey <key>";
	}
	if (!input.modelid.trim()) {
		return "auth quick setup requires --modelid <id>";
	}
	if (
		input.baseurl?.trim() &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_COMPATIBLE &&
		normalizedProvider !== BUILT_IN_PROVIDER.OPENAI_NATIVE
	) {
		return "Base URL 仅支持 OpenAI 及兼容 OpenAI 的服务提供商。";
	}
	return undefined;
}

function saveQuickAuthProviderSettings(input: {
	providerSettingsManager: ProviderSettingsManager;
	providerId: string;
	apikey: string;
	modelid: string;
	baseurl?: string;
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);
	const nextSettings: ProviderSettings = {
		...(existing ?? {
			provider: input.providerId as ProviderSettings["provider"],
		}),
		provider: input.providerId as ProviderSettings["provider"],
		apiKey: input.apikey,
		model: input.modelid,
	};
	if (input.baseurl?.trim()) {
		nextSettings.baseUrl = input.baseurl.trim();
	}
	input.providerSettingsManager.saveProviderSettings(nextSettings);
}

async function askForInputInTerminal(question: string): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("OAuth 登录需要交互式终端会话。");
	}

	return new Promise<string>((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${question} `, (value) => {
			rl.close();
			resolve(value);
		});
	});
}

function createOAuthCallbacks(io: AuthIo): {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: {
		message: string;
		defaultValue?: string;
	}) => Promise<string>;
} {
	return createOAuthClientCallbacks({
		onPrompt: ({ message, defaultValue }) =>
			askForInputInTerminal(message).then((value) => {
				const trimmed = value.trim();
				return trimmed || defaultValue || "";
			}),
		onOutput: (message) => {
			io.writeln(`${c.dim}[auth] ${message}${c.reset}`);
		},
		openUrl: (url) => open(url, { wait: false }).then(() => undefined),
		onOpenUrlError: ({ error }) => {
			io.writeln(
				`${c.dim}[auth] 无法自动打开浏览器；请手动打开上方链接。${c.reset}`,
			);
			io.writeln(
				`${c.dim}[auth] 浏览器打开失败: ${error instanceof Error ? error.message : String(error)}${c.reset}`,
			);
		},
	});
}

async function loginWithOAuthProvider(
	providerId: string,
	existing: ProviderSettings | undefined,
	io: AuthIo,
): Promise<OAuthCredentials> {
	const oauthApi = await getCoreOAuthApi();
	const callbacks = createOAuthCallbacks(io);

	if (providerId === "cline") {
		return oauthApi.loginClineOAuth({
			apiBaseUrl:
				existing?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
			useWorkOSDeviceAuth: true,
			callbacks,
		});
	}

	if (providerId === "oca") {
		const mode = existing?.oca?.mode;
		return oauthApi.loginOcaOAuth({
			mode,
			callbacks,
		});
	}

	if (providerId === "openai-codex") {
		return oauthApi.loginOpenAICodex(callbacks);
	}

	throw new Error(
		`供应商 "${providerId}" 不支持 CLI OAuth 流程 (支持的: 胜算云, openai-codex, oca)`,
	);
}

export function saveOAuthProviderSettings(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
	existing: ProviderSettings | undefined,
	credentials: OAuthCredentials,
): ProviderSettings {
	const auth = {
		...(existing?.auth ?? {}),
		accessToken: toProviderApiKey(providerId, credentials),
		refreshToken: credentials.refresh,
		accountId: credentials.accountId,
	} as ProviderSettings["auth"] & { expiresAt?: number };
	auth.expiresAt = credentials.expires;
	const merged: ProviderSettings = {
		...(existing ?? {
			provider: providerId as ProviderSettings["provider"],
		}),
		provider: providerId as ProviderSettings["provider"],
		auth,
	};
	providerSettingsManager.saveProviderSettings(merged, {
		tokenSource: "oauth",
	});
	return merged;
}

export async function ensureOAuthProviderApiKey(input: {
	providerId: string;
	currentApiKey?: string;
	existingSettings?: ProviderSettings;
	providerSettingsManager: ProviderSettingsManager;
	io: AuthIo;
}): Promise<{
	apiKey?: string;
	selectedProviderSettings?: ProviderSettings;
}> {
	if (input.currentApiKey || !isOAuthProvider(input.providerId)) {
		return {
			apiKey: input.currentApiKey,
			selectedProviderSettings: input.existingSettings,
		};
	}
	const credentials = await loginWithOAuthProvider(
		input.providerId,
		input.existingSettings,
		input.io,
	);
	const selectedProviderSettings = saveOAuthProviderSettings(
		input.providerSettingsManager,
		input.providerId,
		input.existingSettings,
		credentials,
	);
	return {
		apiKey: toProviderApiKey(input.providerId, credentials),
		selectedProviderSettings,
	};
}

async function runQuickAuthSetup(input: AuthCommandInput): Promise<number> {
	const providerId = normalizeProviderId((input.explicitProvider ?? "").trim());
	const apikey = input.apikey?.trim() ?? "";
	const modelid = input.modelid?.trim() ?? "";
	const baseurl = input.baseurl?.trim();
	const validationError = await ensureQuickSetupInputValid(
		{
			provider: providerId,
			apikey,
			modelid,
			baseurl,
		},
		input.providerSettingsManager,
	);
	if (validationError) {
		input.io.writeErr(validationError);
		return 1;
	}
	saveQuickAuthProviderSettings({
		providerSettingsManager: input.providerSettingsManager,
		providerId,
		apikey,
		modelid,
		baseurl,
	});
	input.io.writeln(
		`${c.green}提供商已配置:${c.reset} ${c.cyan}${providerId}${c.reset} (${modelid})`,
	);
	return 0;
}

export async function loadAuthTuiRuntime() {
	disableOpenTuiGraphicsProbe();
	const { createCliRenderer } = await import("@opentui/core");
	const { createRoot } = await import("@opentui/react");
	const { OnboardingView } = await import("../tui/views/onboarding");
	return { createCliRenderer, createRoot, OnboardingView };
}

async function runInteractiveAuthTui(input: AuthCommandInput): Promise<number> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		input.io.writeErr(
			"interactive auth setup requires a TTY (use --provider/--apikey/--modelid for non-interactive setup)",
		);
		return 1;
	}
	const { createCliRenderer, createRoot, OnboardingView } =
		await loadAuthTuiRuntime();
	const renderer = await createCliRenderer({
		exitOnCtrlC: false,
		autoFocus: false,
		enableMouseMovement: true,
	});

	return await new Promise<number>((resolve, reject) => {
		let root: ReturnType<typeof createRoot>;
		try {
			root = createRoot(renderer);
		} catch (error) {
			renderer.destroy();
			reject(error);
			return;
		}
		let settled = false;
		let unmounted = false;
		const unmountRoot = () => {
			if (unmounted) {
				return;
			}
			unmounted = true;
			root.unmount();
		};
		const settle = (code: number) => {
			if (settled) {
				return;
			}
			settled = true;
			unmountRoot();
			renderer.destroy();
			resolve(code);
		};
		renderer.on("destroy", () => {
			unmountRoot();
			if (!settled) {
				settled = true;
				resolve(1);
			}
		});
		try {
			root.render(
				React.createElement(OnboardingView, {
					providerSettingsManager: input.providerSettingsManager,
					onComplete: () => settle(0),
					onExit: () => settle(1),
				}),
			);
		} catch (error) {
			unmountRoot();
			renderer.destroy();
			reject(error);
		}
	});
}

export async function runAuthCommand(input: AuthCommandInput): Promise<number> {
	const hasQuickSetupFlags =
		typeof input.apikey === "string" ||
		typeof input.modelid === "string" ||
		typeof input.baseurl === "string";

	if (hasQuickSetupFlags) {
		if (!input.explicitProvider?.trim()) {
			input.io.writeErr(
				"当使用 --apikey、--modelid 或 --baseurl 时，认证快速安装必须指定 --provider <id>。",
			);
			return 1;
		}
		return runQuickAuthSetup(input);
	}

	if (input.explicitProvider?.trim()) {
		const providerId = normalizeAuthProviderId(input.explicitProvider);
		if (isOAuthProvider(providerId)) {
			return runAuthProviderCommand(
				input.providerSettingsManager,
				providerId,
				input.io,
			);
		}
		input.io.writeErr(
			`提供商 "${providerId}" 需要配置 API 密钥（请使用子命令：auth --provider ${providerId} --apikey <key> --modelid <id>）`,
		);
		return 1;
	}

	return runInteractiveAuthTui(input);
}

export async function runAuthProviderCommand(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
	io: AuthIo,
): Promise<number> {
	if (!isOAuthProvider(providerId)) {
		io.writeErr(
			`提供商 "${providerId}" 不支持 OAuth 登录（支持的提供商：cline, openai-codex, oca）`,
		);
		return 1;
	}
	try {
		const existing = providerSettingsManager.getProviderSettings(providerId);
		const credentials = await loginWithOAuthProvider(providerId, existing, io);
		saveOAuthProviderSettings(
			providerSettingsManager,
			providerId,
			existing,
			credentials,
		);
		io.writeln(
			`${c.green}您已成功登录到 ${c.cyan}${providerId}${c.reset}`,
		);
		return 0;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
