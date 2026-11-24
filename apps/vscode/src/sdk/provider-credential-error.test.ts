import { describe, expect, it } from "vitest"
import { reshapeErrorForWebview } from "./message-translator"
import { describeMissingCredentialError } from "./provider-credential-error"

describe("describeMissingCredentialError", () => {
	it("does not name a provider when the id is unknown", () => {
		expect(describeMissingCredentialError("Missing Authorization header")).toBe(
			"Missing API key for the active provider. Add credentials in Settings, or switch providers.",
		)
	})

	it.each([
		"No Authorization header",
		"Authorization header is required",
		"missing authorization HEADER",
		"AI Gateway error: Missing Authorization header (401)",
	])("matches the no-header signature in %j", (rawMessage) => {
		expect(describeMissingCredentialError(rawMessage, "vercel-ai-gateway")).toBe(
			'Missing API key for provider "vercel-ai-gateway". Add credentials in Settings, or switch providers.',
		)
	})

	it.each([
		"Invalid API key",
		"Unauthorized",
		"authentication failed",
		"invalid_api_key",
		"Model not found",
		"",
	])("leaves %j untouched so a wrong key is never relabelled as missing", (rawMessage) => {
		expect(describeMissingCredentialError(rawMessage, "openai")).toBeUndefined()
	})
})

describe("reshapeErrorForWebview - missing credentials", () => {
	it("passes an invalid-key error through unchanged when unclassified", () => {
		expect(reshapeErrorForWebview({ message: "Invalid API key" }, "openai")).toBe("Invalid API key")
	})
})

describe("reshapeErrorForWebview - rejected credentials (errorClass auth)", () => {
	it("rewrites a classified 401 into actionable guidance and keeps the provider body", () => {
		const reshaped = reshapeErrorForWebview(
			{ message: '{"detail":"Invalid API Key"}' },
			"mistral",
			"mistral-large-2512",
			"auth",
		)
		expect(reshaped).toBe(
			'Provider "mistral" rejected the configured credentials. Re-enter the API key in Settings → API Configuration (checking it is the right kind of key for this provider), or switch providers.\n\nProvider response: {"detail":"Invalid API Key"}',
		)
	})

	it("does not rewrite unclassified errors", () => {
		expect(reshapeErrorForWebview({ message: "boom" }, "mistral", undefined, "unknown")).toBe("boom")
	})

	it("does not rewrite when the provider id is unknown, so a cline-account sign-in card is never suppressed", () => {
		expect(reshapeErrorForWebview({ message: '{"status":401,"message":"Unauthorized"}' }, undefined, undefined, "auth")).toBe(
			'{"status":401,"message":"Unauthorized"}',
		)
	})
})
