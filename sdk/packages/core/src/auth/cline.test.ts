import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClineOAuthCredentials } from "./cline";
import {
	completeClineDeviceAuth,
	getValidClineCredentials,
	loginClineOAuth,
} from "./cline";

const PROVIDER_OPTIONS = {
	apiBaseUrl: "https://auth.example.com",
};
const ORIGINAL_FETCH = globalThis.fetch;

function toBase64Url(value: string): string {
	return Buffer.from(value, "utf8").toString("base64url");
}

function createJwt(payload: Record<string, unknown>): string {
	const settings = toBase64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
	const jwtPayload = toBase64Url(JSON.stringify(payload));

	return `${settings}.${jwtPayload}.sig`;
}

function createCredentials(
	overrides: Partial<ClineOAuthCredentials> = {},
): ClineOAuthCredentials {
	return {
		access: "access-old",
		refresh: "refresh-old",
		expires: 0,
		accountId: "acct-1",
		email: "user@example.com",
		metadata: { provider: "google" },
		...overrides,
	};
}

describe("auth/cline getValidClineCredentials", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("refreshes expired credentials", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({
			expires: 101_000,
			metadata: { provider: "google", sessionStartedAtMs: 12_345 },
		});
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						success: true,
						data: {
							accessToken: "access-new",
							refreshToken: "refresh-new",
							tokenType: "Bearer",
							expiresAt: "2030-01-01T00:00:00.000Z",
							userInfo: {
								subject: "sub-1",
								email: "new@example.com",
								name: "New User",
								clineUserId: "acct-2",
								accounts: [],
							},
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await getValidClineCredentials(current, PROVIDER_OPTIONS);
		expect(result).toMatchObject({
			access: "access-new",
			refresh: "refresh-new",
			accountId: "acct-2",
			email: "new@example.com",
			metadata: {
				provider: "google",
				sessionStartedAtMs: 12_345,
				tokenType: "Bearer",
			},
		});
		nowSpy.mockRestore();
	});

	it("does not add sessionStartedAtMs when refreshing credentials that do not already have it", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({
			expires: 101_000,
			metadata: { provider: "google" },
		});
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						success: true,
						data: {
							accessToken: "access-new",
							refreshToken: "refresh-new",
							tokenType: "Bearer",
							expiresAt: "2030-01-01T00:00:00.000Z",
							userInfo: {
								subject: "sub-1",
								email: "new@example.com",
								name: "New User",
								clineUserId: "acct-2",
								accounts: [],
							},
						},
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
		);
		globalThis.fetch = fetchMock as unknown as typeof fetch;

		const result = await getValidClineCredentials(current, PROVIDER_OPTIONS);
		expect(result?.metadata).toMatchObject({
			provider: "google",
			tokenType: "Bearer",
		});
		expect(result?.metadata).not.toHaveProperty("sessionStartedAtMs");
		nowSpy.mockRestore();
	});

	it("returns null when refresh fails with invalid_grant", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({
			access: createJwt({ sid: "sid-1", sub: "user-1" }),
			expires: 101_000,
			accountId: "cline-user-1",
			metadata: { provider: "google", sessionStartedAtMs: 12_345 },
		});
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: "invalid_grant",
						error_description: "refresh expired",
					}),
					{
						status: 401,
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-invalid-grant",
						},
					},
				),
		) as unknown as typeof fetch;

		const capture = vi.fn();
		const result = await getValidClineCredentials(current, {
			...PROVIDER_OPTIONS,
			telemetry: { capture } as never,
		});
		expect(result).toBeNull();
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_logged_out",
				properties: expect.objectContaining({
					reason: "token_invalid",
					status: 401,
					errorCode: "invalid_grant",
					request_id: "req-invalid-grant",
					sessionId: "sid-1",
					sessionDurationMs: Date.now() - 12_345,
				}),
			}),
		);
		nowSpy.mockRestore();
	});

	it("omits request_id when a failed response has no request ID header", async () => {
		const current = createCredentials({ expires: 0 });
		globalThis.fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: "invalid_grant" }), {
					status: 401,
					headers: { "Content-Type": "application/json" },
				}),
		) as unknown as typeof fetch;

		const capture = vi.fn();
		await getValidClineCredentials(current, {
			...PROVIDER_OPTIONS,
			telemetry: { capture } as never,
		});

		const logoutEvent = capture.mock.calls.find(
			([event]) => event.event === "user.auth_logged_out",
		)?.[0];
		expect(logoutEvent?.properties).not.toHaveProperty("request_id");
	});

	it("keeps current credentials on transient refresh error while token remains valid", async () => {
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({
			access: createJwt({ sid: "sid-2", sub: "-2" }),
			expires: 150_000,
			accountId: undefined,
			metadata: {
				provider: "google",
				sessionStartedAtMs: 67_890,
				userInfo: {
					subject: "subject-2",
					email: "user@example.com",
					name: "User",
					clineUserId: "cline-user-2",
					accounts: [],
				},
			},
		});
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: "server_error",
						error_description: "temporary issue",
					}),
					{
						status: 500,
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-soft-failure-valid",
						},
					},
				),
		) as unknown as typeof fetch;

		const capture = vi.fn();
		const result = await getValidClineCredentials(
			current,
			{ ...PROVIDER_OPTIONS, telemetry: { capture } as never },
			{
				refreshBufferMs: 60_000,
				retryableTokenGraceMs: 30_000,
			},
		);
		expect(result).toBe(current);
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_refresh_soft_failure",
				properties: expect.objectContaining({
					status: 500,
					request_id: "req-soft-failure-valid",
					tokenExpired: false,
					sessionId: "sid-2",
					sessionDurationMs: Date.now() - 67_890,
				}),
			}),
		);
		nowSpy.mockRestore();
	});

	it("throws on transient refresh error when the token is already expired", async () => {
		// A network blip landing after expiry is NOT an invalid grant; returning
		// null here is what made clients wipe stored credentials over an outage.
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(100_000);
		const current = createCredentials({ expires: 90_000 });
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: "server_error",
						error_description: "temporary issue",
					}),
					{
						status: 500,
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-soft-failure-expired",
						},
					},
				),
		) as unknown as typeof fetch;

		const capture = vi.fn();
		await expect(
			getValidClineCredentials(current, {
				...PROVIDER_OPTIONS,
				telemetry: { capture } as never,
			}),
		).rejects.toThrow("Token refresh failed: 500");
		// The "prevented logout" counter: this exact situation used to wipe
		// stored credentials.
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_refresh_soft_failure",
				properties: expect.objectContaining({
					status: 500,
					request_id: "req-soft-failure-expired",
					tokenExpired: true,
				}),
			}),
		);
		expect(capture).not.toHaveBeenCalledWith(
			expect.objectContaining({ event: "user.auth_logged_out" }),
		);
		nowSpy.mockRestore();
	});
});

describe("auth/cline loginClineOAuth", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("includes the request ID when initial authentication fails", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: "invalid_request",
						error_description: "device auth failed",
					}),
					{
						status: 400,
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-device-authorization",
						},
					},
				),
		) as unknown as typeof fetch;
		const capture = vi.fn();

		await expect(
			loginClineOAuth({
				apiBaseUrl: "https://api.cline.bot",
				useWorkOSDeviceAuth: true,
				telemetry: { capture } as never,
				callbacks: {
					onAuth: vi.fn(),
					onPrompt: async () => "",
				},
			}),
		).rejects.toThrow("Device authorization failed: 400");
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_failed",
				properties: expect.objectContaining({
					request_id: "req-device-authorization",
				}),
			}),
		);
	});
});

describe("auth/cline completeClineDeviceAuth", () => {
	it.each([
		"authorization_pending",
		"slow_down",
	])("stops polling during %s when cancelled", async (error) => {
		const controller = new AbortController();
		const fetch = vi.fn(
			async () => new Response(JSON.stringify({ error }), { status: 400 }),
		);
		globalThis.fetch = fetch as unknown as typeof globalThis.fetch;
		const login = completeClineDeviceAuth({
			deviceCode: "device-code",
			expiresInSeconds: 300,
			pollIntervalSeconds: 60,
			apiBaseUrl: "https://example.test",
			signal: controller.signal,
		});
		const rejected = expect(login).rejects.toMatchObject({
			name: "AbortError",
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(fetch).toHaveBeenCalledOnce();
		controller.abort();
		await rejected;
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("aborts an in-flight polling request", async () => {
		const controller = new AbortController();
		let requestSignal: AbortSignal | undefined;
		globalThis.fetch = vi.fn(async (_url, init) => {
			requestSignal = init?.signal as AbortSignal;
			return await new Promise<Response>((_, reject) =>
				requestSignal?.addEventListener(
					"abort",
					() => reject(requestSignal?.reason),
					{ once: true },
				),
			);
		});
		const login = completeClineDeviceAuth({
			deviceCode: "device-code",
			expiresInSeconds: 300,
			pollIntervalSeconds: 1,
			apiBaseUrl: "https://example.test",
			signal: controller.signal,
		});
		const rejected = expect(login).rejects.toMatchObject({
			name: "AbortError",
		});
		controller.abort();
		await rejected;
		expect(requestSignal?.aborted).toBe(true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = ORIGINAL_FETCH;
	});

	it("includes the request ID when device polling fails", async () => {
		globalThis.fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						error: "access_denied",
						error_description: "authorization denied",
					}),
					{
						status: 403,
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-device-poll",
						},
					},
				),
		) as unknown as typeof fetch;
		const capture = vi.fn();

		await expect(
			completeClineDeviceAuth({
				deviceCode: "device-code",
				expiresInSeconds: 300,
				pollIntervalSeconds: 1,
				apiBaseUrl: "https://api.cline.bot",
				telemetry: { capture } as never,
			}),
		).rejects.toThrow("authorization denied");
		expect(capture).toHaveBeenCalledWith(
			expect.objectContaining({
				event: "user.auth_failed",
				properties: expect.objectContaining({ request_id: "req-device-poll" }),
			}),
		);
	});
});
