/**
 * Canonical list of OAuth provider IDs managed by the platform.
 * Derive sets, types, and guards from this single source of truth.
 */
export declare const OAUTH_PROVIDER_IDS: readonly [
	"shengsuanyun",
	"oca",
	"openai-codex",
	"cline",
];
export type OAuthProviderId = (typeof OAUTH_PROVIDER_IDS)[number];
/**
 * Check whether a provider ID is a managed OAuth provider.
 */
export declare function isOAuthProviderId(
	providerId: string,
): providerId is OAuthProviderId;
/**
 * Error‑message sub-strings that indicate an auth / credential failure.
 * Used to decide whether a failed API call should trigger an OAuth refresh.
 */
export declare const AUTH_ERROR_PATTERNS: readonly [
	"401",
	"403",
	"unauthorized",
	"forbidden",
	"invalid token",
	"expired token",
	"authentication",
];
/**
 * Returns `true` when `error` looks like an authentication failure
 * *and* the provider is a managed OAuth provider.
 */
export declare function isLikelyAuthError(
	error: unknown,
	providerId: string,
): boolean;
