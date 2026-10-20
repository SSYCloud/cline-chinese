/**
 * Returns true when `token` is a JWT whose `exp` claim is in the past.
 *
 * @param token - The raw token (JWT or opaque string).
 * @param leewaySeconds - Treat tokens expiring within this window as expired.
 */
export function isJwtExpired(token: string | undefined, leewaySeconds = 0): boolean {
	if (!token) {
		return false
	}
	const parts = token.split(".")
	if (parts.length !== 3) {
		return false
	}
	try {
		const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as { exp?: unknown }
		if (typeof payload.exp !== "number") {
			return false
		}
		return payload.exp * 1000 <= Date.now() + leewaySeconds * 1000
	} catch {
		return false
	}
}
