import type { ProviderSettings } from "@cline/core";
import { describe, expect, it } from "vitest";
import { isProviderConfigured } from "./provider-auth";

describe("isProviderConfigured", () => {
	it("returns false when settings is undefined", () => {
		expect(isProviderConfigured("anthropic", undefined)).toBe(false);
	});

	it("returns false when api-key settings have no useful fields", () => {
		expect(
			isProviderConfigured("anthropic", {
				provider: "anthropic",
			} satisfies ProviderSettings),
		).toBe(false);
	});

	it("treats any persisted api key as configured", () => {
		expect(
			isProviderConfigured("anthropic", {
				provider: "anthropic",
				apiKey: "sk-test",
			} satisfies ProviderSettings),
		).toBe(true);
	});

	it("requires an OAuth access token for cline", () => {
		expect(
			isProviderConfigured("cline", {
				provider: "cline",
			} satisfies ProviderSettings),
		).toBe(false);

		expect(
			isProviderConfigured("cline", {
				provider: "cline",
				auth: { accessToken: "workos:abc" },
			} satisfies ProviderSettings),
		).toBe(true);
	});
});
