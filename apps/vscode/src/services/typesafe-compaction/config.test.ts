import { describe, it } from "bun:test"
import { DEFAULT_TYPESAFE_MODEL } from "@shared/typesafe-models"
import { expect } from "chai"
import { resolveTypesafeConfig, type TypesafeSettingsSource } from "./config"

const source = (values: Record<string, unknown>, secrets: Record<string, string | undefined> = {}): TypesafeSettingsSource => ({
	getSecretKey: (key) => secrets[key],
	getGlobalSettingsKey: (key) => values[key] as never,
})

describe("resolveTypesafeConfig", () => {
	it("falls back to the 胜算云 key when no dedicated SystemOne key is set", () => {
		const config = resolveTypesafeConfig(source({}, { shengSuanYunApiKey: " sy-key " }))
		expect(config.apiKey).to.equal("sy-key")
	})

	it("prefers the dedicated SystemOne key over the 胜算云 key", () => {
		const config = resolveTypesafeConfig(source({}, { typesafeApiKey: "typesafe-key", shengSuanYunApiKey: "sy-key" }))
		expect(config.apiKey).to.equal("typesafe-key")
	})

	it("uses defaults for an unconfigured model, base URL and thresholds", () => {
		const config = resolveTypesafeConfig(source({}))
		expect(config).to.deep.equal({
			apiKey: "",
			model: DEFAULT_TYPESAFE_MODEL,
			baseUrl: undefined,
			testDeleteThreshold: 0.1,
			contextDeleteThreshold: 0.5,
		})
	})

	it("trims a custom base URL and clamps thresholds into 0-1", () => {
		const config = resolveTypesafeConfig(
			source({
				typesafeBaseUrl: " https://example.test/decisions ",
				typesafeTestDeleteThreshold: 3,
				typesafeContextDeleteThreshold: -1,
			}),
		)
		expect(config.baseUrl).to.equal("https://example.test/decisions")
		expect(config.testDeleteThreshold).to.equal(1)
		expect(config.contextDeleteThreshold).to.equal(0)
	})

	it("treats a blank base URL as the default endpoint", () => {
		expect(resolveTypesafeConfig(source({ typesafeBaseUrl: "   " })).baseUrl).to.equal(undefined)
	})
})
