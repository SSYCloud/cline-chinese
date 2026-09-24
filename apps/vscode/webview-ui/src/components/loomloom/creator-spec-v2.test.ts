import { describe, expect, it } from "vitest"
import { buildSimpleCreatorSpec } from "./creator-spec-v2"

const authority = [
	{
		profileId: "text.basic.example.v1",
		output: { text: true },
		inputPorts: [{ portId: "prompt", kind: "value", valueType: "string", required: true }],
		eligibleModels: [{ modelId: "authoritative/model" }],
	},
]

describe("TemplateSpec v2 simple creator", () => {
	it("binds a live capability/model and composes the fixed instruction with each row input", () => {
		const spec = buildSimpleCreatorSpec(
			{
				name: "文案改写",
				description: "每行改写一段文案",
				instruction: "保持事实不变，语言更简洁。",
				samplePrompt: "这是原文。",
				profileId: authority[0].profileId,
				modelId: authority[0].eligibleModels[0].modelId,
			},
			authority,
		)
		expect(spec).toMatchObject({
			meta: { name: "文案改写", primaryOutputType: "text" },
			templateInputs: { prompt: { valueType: "string", required: true } },
			steps: [
				{
					executionBinding: { kind: "capabilityProfile", profileId: authority[0].profileId },
					modelSelection: { defaultModelId: "authoritative/model" },
					inputBindings: {
						prompt: {
							source: "composeValue",
							compose: {
								parts: [
									{ source: "literal", literal: "保持事实不变，语言更简洁。" },
									{ source: "templateInput", inputKey: "prompt" },
								],
							},
						},
					},
				},
			],
		})
		expect(spec).not.toHaveProperty("inputSchema")
		expect(spec).not.toHaveProperty("fieldBindings")
	})
	it("refuses a model not returned by the selected live authoring profile", () => {
		expect(() =>
			buildSimpleCreatorSpec(
				{
					name: "文案改写",
					description: "",
					instruction: "改写",
					samplePrompt: "原文",
					profileId: authority[0].profileId,
					modelId: "guessed/model",
				},
				authority,
			),
		).toThrow(/模型已不在当前能力/)
	})
})
