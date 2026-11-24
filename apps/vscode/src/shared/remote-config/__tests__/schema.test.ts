import { describe, it } from "bun:test"
import { expect } from "chai"
import {
	AwsBedrockSettingsSchema,
	ClineSettingsSchema,
	EnterpriseTelemetrySchema,
	OpenAiCompatibleSchema,
	PromptUploadingSchema,
	type RemoteConfig,
	RemoteConfigSchema,
	S3AccessKeySettingsSchema,
} from "../schema"

describe("Remote Config Schema", () => {
	describe("EnterpriseTelemetry", () => {
		it("accepts an empty object", () => {
			const result = EnterpriseTelemetrySchema.parse({})

			expect(result).to.deep.equal({})
		})
	})

	describe("S3AccessKeySettingsSchema", () => {
		it("should accept valid S3 access key settings with required fields", () => {
			const validSettings = {
				bucket: "my-bucket",
				accessKeyId: "AKIAIOSFODNN7EXAMPLE",
				secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
			}
			const result = S3AccessKeySettingsSchema.parse(validSettings)
			expect(result).to.deep.equal(validSettings)
		})

		it("should accept S3 settings with queue configuration fields", () => {
			const settings = {
				bucket: "my-bucket",
				accessKeyId: "AKIAIOSFODNN7EXAMPLE",
				secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
				intervalMs: 60000,
				maxRetries: 5,
				batchSize: 50,
				maxQueueSize: 500,
				maxFailedAgeMs: 172800000,
				backfillEnabled: false,
			}
			const result = S3AccessKeySettingsSchema.parse(settings)
			expect(result.intervalMs).to.equal(60000)
			expect(result.maxRetries).to.equal(5)
			expect(result.batchSize).to.equal(50)
			expect(result.maxQueueSize).to.equal(500)
			expect(result.maxFailedAgeMs).to.equal(172800000)
			expect(result.backfillEnabled).to.equal(false)
		})

		it("should reject S3 settings with invalid intervalMs type", () => {
			expect(() =>
				S3AccessKeySettingsSchema.parse({
					bucket: "my-bucket",
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
					secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
					intervalMs: "30000",
				}),
			).to.throw()
		})

		it("should reject S3 settings with invalid maxRetries type", () => {
			expect(() =>
				S3AccessKeySettingsSchema.parse({
					bucket: "my-bucket",
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
					secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
					maxRetries: "3",
				}),
			).to.throw()
		})

		it("should reject S3 settings with invalid backfillEnabled type", () => {
			expect(() =>
				S3AccessKeySettingsSchema.parse({
					bucket: "my-bucket",
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
					secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
					backfillEnabled: "true",
				}),
			).to.throw()
		})

		it("should reject S3 settings with missing bucket", () => {
			expect(() =>
				S3AccessKeySettingsSchema.parse({
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
					secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
				}),
			).to.throw()
		})

		it("should reject S3 settings with missing accessKeyId", () => {
			expect(() =>
				S3AccessKeySettingsSchema.parse({
					bucket: "my-bucket",
					secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
				}),
			).to.throw()
		})

		it("should reject S3 settings with missing secretAccessKey", () => {
			expect(() =>
				S3AccessKeySettingsSchema.parse({
					bucket: "my-bucket",
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
				}),
			).to.throw()
		})
	})

	describe("PromptUploadingSchema", () => {
		it("should accept enabled field only", () => {
			const result = PromptUploadingSchema.parse({ enabled: true })
			expect(result.enabled).to.equal(true)
		})

		it("should accept enabled as false", () => {
			const result = PromptUploadingSchema.parse({ enabled: false })
			expect(result.enabled).to.equal(false)
		})

		it("should reject invalid type values", () => {
			expect(() => PromptUploadingSchema.parse({ type: "invalid_type" })).to.throw()
			expect(() => PromptUploadingSchema.parse({ type: "s3" })).to.throw()
			expect(() => PromptUploadingSchema.parse({ type: "" })).to.throw()
		})

		it("should accept complete prompt uploading configuration", () => {
			const fullConfig = {
				enabled: true,
				type: "s3_access_keys" as const,
				s3AccessSettings: {
					bucket: "prompt-uploads-bucket",
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
					secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
					region: "us-west-2",
					endpoint: "https://s3.us-west-2.amazonaws.com",
					accountId: "123456789012",
					intervalMs: 30000,
					maxRetries: 3,
					batchSize: 100,
					maxQueueSize: 1000,
					maxFailedAgeMs: 86400000,
					backfillEnabled: true,
				},
			}
			const result = PromptUploadingSchema.parse(fullConfig)
			expect(result).to.deep.equal(fullConfig)
			expect(result.enabled).to.equal(true)
			expect(result.type).to.equal("s3_access_keys")
			expect(result.s3AccessSettings?.bucket).to.equal("prompt-uploads-bucket")
			expect(result.s3AccessSettings?.region).to.equal("us-west-2")
			expect(result.s3AccessSettings?.intervalMs).to.equal(30000)
			expect(result.s3AccessSettings?.maxRetries).to.equal(3)
			expect(result.s3AccessSettings?.batchSize).to.equal(100)
			expect(result.s3AccessSettings?.maxQueueSize).to.equal(1000)
			expect(result.s3AccessSettings?.maxFailedAgeMs).to.equal(86400000)
			expect(result.s3AccessSettings?.backfillEnabled).to.equal(true)
		})

		it("should accept s3AccessSettings without optional fields", () => {
			const config = {
				enabled: true,
				type: "s3_access_keys" as const,
				s3AccessSettings: {
					bucket: "my-bucket",
					accessKeyId: "AKIAIOSFODNN7EXAMPLE",
					secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
				},
			}
			const result = PromptUploadingSchema.parse(config)
			expect(result.s3AccessSettings?.bucket).to.equal("my-bucket")
			expect(result.s3AccessSettings?.region).to.be.undefined
			expect(result.s3AccessSettings?.endpoint).to.be.undefined
			expect(result.s3AccessSettings?.accountId).to.be.undefined
			expect(result.s3AccessSettings?.intervalMs).to.be.undefined
			expect(result.s3AccessSettings?.maxRetries).to.be.undefined
			expect(result.s3AccessSettings?.batchSize).to.be.undefined
			expect(result.s3AccessSettings?.maxQueueSize).to.be.undefined
			expect(result.s3AccessSettings?.maxFailedAgeMs).to.be.undefined
			expect(result.s3AccessSettings?.backfillEnabled).to.be.undefined
		})

		it("should reject s3AccessSettings with missing required fields", () => {
			expect(() =>
				PromptUploadingSchema.parse({
					enabled: true,
					s3AccessSettings: {
						accessKeyId: "AKIAIOSFODNN7EXAMPLE",
						secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
					},
				}),
			).to.throw()
		})

		it("should reject invalid enabled type", () => {
			expect(() => PromptUploadingSchema.parse({ enabled: "yes" })).to.throw()
			expect(() => PromptUploadingSchema.parse({ enabled: 1 })).to.throw()
		})
	})

	describe("OpenAiCompatibleSchema", () => {
		it("should accept valid OpenAI compatible settings", () => {
			const validSettings = {
				models: [
					{
						id: "gpt-4",
						temperature: 0.7,
						maxTokens: 4096,
						contextWindow: 128000,
						inputPrice: 0.03,
						outputPrice: 0.06,
						supportsImages: true,
					},
					{
						id: "gpt-3.5-turbo",
						temperature: 0.7,
						maxTokens: 4096,
						contextWindow: 16000,
						inputPrice: 0.001,
						outputPrice: 0.002,
						supportsImages: false,
					},
				],
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiHeaders: { "X-Custom-Header": "value" },
				azureApiVersion: "2024-02-15-preview",
			}
			const result = OpenAiCompatibleSchema.parse(validSettings)
			expect(result).to.deep.equal(validSettings)
		})

		it("should have undefined for models and openAiHeaders by default", () => {
			const result = OpenAiCompatibleSchema.parse({})
			expect(result.models).to.be.undefined
			expect(result.openAiHeaders).to.be.undefined
		})

		it("should reject invalid field types", () => {
			expect(() => OpenAiCompatibleSchema.parse({ models: "not-an-array" })).to.throw()
			expect(() => OpenAiCompatibleSchema.parse({ openAiHeaders: "not-an-object" })).to.throw()
		})

		it("should reject models with missing id field", () => {
			expect(() =>
				OpenAiCompatibleSchema.parse({
					models: [{ temperature: 0.7 }],
				}),
			).to.throw()
		})

		it("should accept headers as record of strings", () => {
			const settings = {
				openAiHeaders: {
					Authorization: "Bearer token",
					"Content-Type": "application/json",
				},
			}
			const result = OpenAiCompatibleSchema.parse(settings)
			expect(result.openAiHeaders).to.deep.equal(settings.openAiHeaders)
		})
	})

	describe("ClineSettingsSchema", () => {
		it("should accept valid Cline provider settings", () => {
			const validSettings = {
				models: [{ id: "claude-3-5-sonnet-20241022" }, { id: "claude-3-5-haiku-20241022" }],
			}
			const result = ClineSettingsSchema.parse(validSettings)
			expect(result).to.deep.equal(validSettings)
		})
	})

	describe("AwsBedrockSettingsSchema", () => {
		it("should accept valid AWS Bedrock settings", () => {
			const validSettings = {
				models: [
					{ id: "anthropic.claude-v2", thinkingBudgetTokens: 1600 },
					{ id: "anthropic.claude-instant-v1", thinkingBudgetTokens: 800 },
				],
				customModels: [
					{ name: "my-custom-model", baseModelId: "anthropic.claude-v2" },
					{ name: "another-model", baseModelId: "anthropic.claude-instant-v1" },
				],
				awsRegion: "us-east-1",
				awsUseCrossRegionInference: true,
				awsBedrockUsePromptCache: true,
				awsBedrockEndpoint: "https://bedrock.us-east-1.amazonaws.com",
			}
			const result = AwsBedrockSettingsSchema.parse(validSettings)
			expect(result).to.deep.equal(validSettings)
		})

		it("should accept models with thinkingBudgetTokens", () => {
			const settings = {
				models: [
					{ id: "anthropic.claude-v2", thinkingBudgetTokens: 1600 },
					{ id: "anthropic.claude-instant-v1", thinkingBudgetTokens: 800 },
				],
			}
			const result = AwsBedrockSettingsSchema.parse(settings)
			expect(result.models).to.have.lengthOf(2)
			expect(result.models?.[0].thinkingBudgetTokens).to.equal(1600)
		})

		it("should reject invalid field types", () => {
			expect(() => AwsBedrockSettingsSchema.parse({ models: "not-an-array" })).to.throw()
			expect(() => AwsBedrockSettingsSchema.parse({ customModels: "not-an-array" })).to.throw()
		})

		it("should reject custom models with missing fields", () => {
			expect(() =>
				AwsBedrockSettingsSchema.parse({
					customModels: [{ name: "missing-base-model" }],
				}),
			).to.throw()
			expect(() =>
				AwsBedrockSettingsSchema.parse({
					customModels: [{ baseModelId: "missing-name" }],
				}),
			).to.throw()
		})
	})

	describe("MCPSettingsSchema", () => {
		it("should reject servers with a missing id", () => {
			const config = {
				version: "v1",
				allowedMCPServers: [{}],
			}

			expect(() => RemoteConfigSchema.parse(config)).to.throw()
		})

		it("should accept valid MCP settings", () => {
			const config = {
				version: "v1",
				mcpMarketplaceEnabled: true,
				allowedMCPServers: [{ id: "https://github.com/mcp/filesystem" }, { id: "https://github.com/mcp/github" }],
			}

			const result = RemoteConfigSchema.parse(config)
			expect(result.mcpMarketplaceEnabled).to.equal(true)
			expect(result.allowedMCPServers).to.deep.equal(config.allowedMCPServers)
		})
	})

	describe("RemoteMCPServersSchema", () => {
		it("should accept remoteMCPServers with alwaysEnabled false", () => {
			const config = {
				version: "v1",
				remoteMCPServers: [{ name: "toggle-server", url: "https://example.com/mcp", alwaysEnabled: false }],
			}

			const result = RemoteConfigSchema.parse(config)
			expect(result.remoteMCPServers).to.have.lengthOf(1)
			expect(result.remoteMCPServers?.[0].alwaysEnabled).to.equal(false)
		})

		it("should accept remoteMCPServers without alwaysEnabled (defaults to undefined)", () => {
			const config = {
				version: "v1",
				remoteMCPServers: [{ name: "default-server", url: "https://example.com/mcp" }],
			}

			const result = RemoteConfigSchema.parse(config)
			expect(result.remoteMCPServers).to.have.lengthOf(1)
			expect(result.remoteMCPServers?.[0].name).to.equal("default-server")
			expect(result.remoteMCPServers?.[0].url).to.equal("https://example.com/mcp")
			expect(result.remoteMCPServers?.[0].alwaysEnabled).to.be.undefined
		})

		it("should accept multiple remoteMCPServers with mixed alwaysEnabled values", () => {
			const config = {
				version: "v1",
				remoteMCPServers: [
					{ name: "always-on", url: "https://example1.com/mcp", alwaysEnabled: true },
					{ name: "toggle", url: "https://example2.com/mcp", alwaysEnabled: false },
					{ name: "default", url: "https://example3.com/mcp" },
				],
			}

			const result = RemoteConfigSchema.parse(config)
			expect(result.remoteMCPServers).to.have.lengthOf(3)
			expect(result.remoteMCPServers?.[0].alwaysEnabled).to.equal(true)
			expect(result.remoteMCPServers?.[1].alwaysEnabled).to.equal(false)
			expect(result.remoteMCPServers?.[2].alwaysEnabled).to.be.undefined
		})

		it("should reject remoteMCPServers with missing name", () => {
			const config = {
				version: "v1",
				remoteMCPServers: [{ url: "https://example.com/mcp", alwaysEnabled: true }],
			}

			expect(() => RemoteConfigSchema.parse(config)).to.throw()
		})

		it("should reject remoteMCPServers with missing url", () => {
			const config = {
				version: "v1",
				remoteMCPServers: [{ name: "test-server", alwaysEnabled: true }],
			}

			expect(() => RemoteConfigSchema.parse(config)).to.throw()
		})

		it("should reject remoteMCPServers with invalid alwaysEnabled type", () => {
			const config = {
				version: "v1",
				remoteMCPServers: [{ name: "test-server", url: "https://example.com/mcp", alwaysEnabled: "yes" }],
			}

			expect(() => RemoteConfigSchema.parse(config)).to.throw()
		})

		it("should accept headers", () => {
			const config = {
				version: "v1",
				remoteMCPServers: [{ name: "test-server", url: "https://example.com/mcp", headers: { Authorization: "test" } }],
			}

			const result = RemoteConfigSchema.parse(config)
			expect(result.remoteMCPServers).to.have.lengthOf(1)
			expect(result.remoteMCPServers?.[0].headers).to.deep.equal({ Authorization: "test" })
		})
	})

	describe("RemoteConfigSchema", () => {
		it("should accept valid complete remote config", () => {
			const validConfig: RemoteConfig = {
				version: "v1",
				telemetryEnabled: true,
				kanbanEnabled: true,
				mcpMarketplaceEnabled: true,
				yoloModeAllowed: false,
				providerSettings: {
					OpenAiCompatible: {
						models: [{ id: "gpt-4" }],
						openAiBaseUrl: "https://api.openai.com/v1",
						openAiHeaders: {},
					},
					AwsBedrock: {
						models: [{ id: "anthropic.claude-v2" }],
						awsRegion: "us-west-2",
					},
				},
			}
			const result = RemoteConfigSchema.parse(validConfig)
			expect(result).to.deep.equal(validConfig)
		})

		it("should require version field", () => {
			const configWithoutVersion = {}
			expect(() => RemoteConfigSchema.parse(configWithoutVersion)).to.throw()
		})

		it("should accept config with general settings only", () => {
			const configWithGeneralSettings = {
				version: "v1",
				telemetryEnabled: false,
				mcpMarketplaceEnabled: false,
				yoloModeAllowed: true,
			}
			const result = RemoteConfigSchema.parse(configWithGeneralSettings)
			expect(result.telemetryEnabled).to.equal(false)
			expect(result.mcpMarketplaceEnabled).to.equal(false)
			expect(result.yoloModeAllowed).to.equal(true)
		})

		it("should accept config with AWS Bedrock provider only", () => {
			const config = {
				version: "v1",
				providerSettings: {
					AwsBedrock: {
						models: [{ id: "anthropic.claude-v2" }],
						awsRegion: "us-east-1",
					},
				},
			}
			expect(() => RemoteConfigSchema.parse(config)).to.not.throw()
		})

		it("should reject invalid version type", () => {
			expect(() => RemoteConfigSchema.parse({ version: 123 })).to.throw()
		})

		it("should reject invalid telemetry setting type", () => {
			expect(() =>
				RemoteConfigSchema.parse({
					version: "v1",
					telemetryEnabled: "yes",
				}),
			).to.throw()
		})
	})
})
