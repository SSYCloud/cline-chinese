import {
	captureProviderConfigured,
	completeClineDeviceAuth,
	type ITelemetryService,
	loginLocalProvider,
	type ProviderSettingsManager,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
	startClineDeviceAuth,
} from "@coohu/core";
import { getClineEnvironmentConfig } from "@coohu/shared";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import open from "open";

export type OnboardingOAuthProviderId =
	| "cline"
	| "oca"
	| "openai-codex"
	| "shengsuanyun";

export function isOnboardingOAuthProviderId(
	providerId: string,
): providerId is OnboardingOAuthProviderId {
	return (
		providerId === "cline" ||
		providerId === "oca" ||
		providerId === "openai-codex" ||
		providerId === "shengsuanyun"
	);
}

const SSY_AUTH_FROM_ID = "CH_R39YE8W1";
const SSY_AUTH_KEYS_URL = "https://api.shengsuanyun.com/auth/keys";
const SSY_AUTH_URL = "https://router.shengsuanyun.com/auth";

export function runSSYAuthFlow(input: {
	providerSettingsManager: ProviderSettingsManager;
	isAborted: () => boolean;
	setStatus: (status: string) => void;
	setAuthUrl: (url: string) => void;
	setError: (error: string) => void;
	onComplete: (providerId: "shengsuanyun") => void;
	setCleanup: (close: () => void) => void;
	telemetry?: ITelemetryService;
}): void {
	let port = 0;

	const server = http.createServer((req, res) => {
		const urlObj = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
		if (urlObj.pathname !== "/callback") {
			res.writeHead(404);
			res.end();
			return;
		}
		const code = urlObj.searchParams.get("code");
		if (!code) {
			res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
			res.end(
				"<html><body>登录失败：未收到授权码，请关闭此页面并重试。</body></html>",
			);
			return;
		}

		res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
		res.end(
			"<html><body><script>window.close();</script>登录成功！请返回终端继续操作。</body></html>",
		);
		server.close();

		if (input.isAborted()) return;
		input.setStatus("正在获取凭据...");

		const callbackUrl = `http://127.0.0.1:${port}/callback`;
		fetch(SSY_AUTH_KEYS_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ code, callback_url: callbackUrl }),
		})
			.then((r) => r.json())
			.then((data: unknown) => {
				if (input.isAborted()) return;
				const d = (data as { data?: { api_key?: string; jwt_token?: string } })
					?.data;
				if (!d) {
					input.setError("获取凭据失败：服务器响应无效");
					input.setStatus("认证失败");
					return;
				}
				const apiKey = d.api_key ?? "";
				const jwtToken = d.jwt_token ?? "";
				if (!apiKey && !jwtToken) {
					input.setError("获取凭据失败：API Key 和 Token 均为空");
					input.setStatus("认证失败");
					return;
				}
				saveLocalProviderSettings(input.providerSettingsManager, {
					providerId: "shengsuanyun",
					apiKey: apiKey || jwtToken,
				});
				captureProviderConfigured(input.telemetry, "shengsuanyun");
				input.onComplete("shengsuanyun");
			})
			.catch((err: unknown) => {
				if (input.isAborted()) return;
				input.setError(err instanceof Error ? err.message : String(err));
				input.setStatus("认证失败");
			});
	});

	server.listen(0, "127.0.0.1", () => {
		if (input.isAborted()) {
			server.close();
			return;
		}
		port = (server.address() as AddressInfo).port;
		const callbackUrl = `http://127.0.0.1:${port}/callback`;
		const authUrl = `${SSY_AUTH_URL}?from=${SSY_AUTH_FROM_ID}&callback_url=${encodeURIComponent(callbackUrl)}`;

		input.setCleanup(() => server.close());
		input.setAuthUrl(authUrl);
		input.setStatus("等待登录...");

		try {
			void open(authUrl, { wait: false }).catch(() => {
				input.setStatus("无法打开浏览器，请访问下方链接。");
			});
		} catch {
			input.setStatus("无法打开浏览器，请访问下方链接。");
		}
	});

	server.on("error", (err) => {
		input.setError(`无法启动本地服务: ${err.message}`);
		input.setStatus("认证失败");
	});
}

export function runOAuthAuthFlow(input: {
	providerId: OnboardingOAuthProviderId;
	providerSettingsManager: ProviderSettingsManager;
	isAborted: () => boolean;
	setStatus: (status: string) => void;
	setAuthUrl: (url: string) => void;
	setError: (error: string) => void;
	onComplete: (providerId: OnboardingOAuthProviderId) => void;
	telemetry?: ITelemetryService;
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);

	loginLocalProvider(
		input.providerId,
		existing,
		(url: string) => {
			input.setAuthUrl(url);
			input.setStatus("Waiting for sign-in...");
			try {
				void open(url, { wait: false }).catch(() => {
					input.setStatus("Could not open browser. Visit the URL below.");
				});
			} catch {
				input.setStatus("Could not open browser. Visit the URL below.");
			}
		},
		input.telemetry,
	)
		.then((credentials) => {
			if (input.isAborted()) return;
			saveLocalProviderOAuthCredentials(
				input.providerSettingsManager,
				input.providerId,
				existing,
				credentials,
			);
			input.onComplete(input.providerId);
		})
		.catch((err: unknown) => {
			if (input.isAborted()) return;
			input.setError(err instanceof Error ? err.message : String(err));
			input.setStatus("Authentication failed");
		});
}

export function runDeviceCodeAuthFlow(input: {
	providerId: OnboardingOAuthProviderId;
	providerSettingsManager: ProviderSettingsManager;
	isAborted: () => boolean;
	setUserCode: (code: string) => void;
	setVerifyUrl: (url: string) => void;
	setStatus: (status: string) => void;
	setError: (error: string) => void;
	onComplete: (providerId: OnboardingOAuthProviderId) => void;
	telemetry?: ITelemetryService;
}): void {
	const existing = input.providerSettingsManager.getProviderSettings(
		input.providerId,
	);
	const apiBaseUrl =
		existing?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl;

	// `startClineDeviceAuth` only requests the user/device code pair; the
	// `auth_started` telemetry event is emitted by `completeClineDeviceAuth`
	// (which owns the actual login lifecycle), so we intentionally do NOT
	// pass telemetry into `startClineDeviceAuth` here.
	startClineDeviceAuth()
		.then((result) => {
			if (input.isAborted()) return;
			input.setUserCode(result.userCode);
			input.setVerifyUrl(
				result.verificationUriComplete || result.verificationUri,
			);
			input.setStatus("Enter the code at the URL below");

			completeClineDeviceAuth({
				deviceCode: result.deviceCode,
				expiresInSeconds: result.expiresInSeconds,
				pollIntervalSeconds: result.pollIntervalSeconds,
				apiBaseUrl,
				provider: input.providerId,
				telemetry: input.telemetry,
			})
				.then((credentials) => {
					if (input.isAborted()) return;
					saveLocalProviderOAuthCredentials(
						input.providerSettingsManager,
						input.providerId,
						existing,
						credentials,
					);
					input.onComplete(input.providerId);
				})
				.catch((err: unknown) => {
					if (input.isAborted()) return;
					input.setError(err instanceof Error ? err.message : String(err));
					input.setStatus("Authentication failed");
				});
		})
		.catch((err: unknown) => {
			if (input.isAborted()) return;
			input.setError(err instanceof Error ? err.message : String(err));
			input.setStatus("Could not start device code flow");
		});
}
