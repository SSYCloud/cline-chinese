/** The simple editor emits only the documented TemplateSpec v2 one-step shape.
 * The LoomLoom validate endpoint remains authoritative for contract/binding rules.
 */
export type CreatorProfile = {
	profileId: string
	capability?: string
	output?: { text?: boolean }
	inputPorts?: Array<{ portId: string; kind?: string; valueType?: string; required?: boolean }>
	eligibleModels?: Array<{ modelId: string; displayName?: string }>
}

export type SimpleCreatorInput = {
	name: string
	description: string
	instruction: string
	samplePrompt: string
	profileId: string
	modelId: string
}

export function simpleTextProfiles(profiles: CreatorProfile[]): CreatorProfile[] {
	return profiles.filter(
		(profile) =>
			profile.output?.text === true &&
			profile.inputPorts?.some(
				(port) => port.portId === "prompt" && port.valueType === "string" && (!port.kind || port.kind === "value"),
			) &&
			profile.inputPorts.every((port) => !port.required || port.portId === "prompt") &&
			(profile.eligibleModels?.length ?? 0) > 0,
	)
}

export function buildSimpleCreatorSpec(input: SimpleCreatorInput, profiles: CreatorProfile[]): Record<string, unknown> {
	const name = input.name.trim()
	const instruction = input.instruction.trim()
	const samplePrompt = input.samplePrompt.trim()
	if (!name || !instruction || !samplePrompt) throw new Error("请填写名称、固定要求和一条示例输入。")
	const profile = simpleTextProfiles(profiles).find((item) => item.profileId === input.profileId)
	if (!profile) throw new Error("当前服务未提供所选文本能力，请重新选择。")
	if (!profile.eligibleModels?.some((model) => model.modelId === input.modelId)) {
		throw new Error("所选模型已不在当前能力的可用列表中，请重新选择。")
	}
	return {
		meta: { name, description: input.description.trim(), primaryOutputType: "text" },
		templateInputs: {
			prompt: {
				kind: "value",
				valueType: "string",
				required: true,
				blankPolicy: "error",
				presentation: { label: "输入内容", order: 10 },
			},
			modelChoice: {
				kind: "value",
				valueType: "string",
				required: false,
				blankPolicy: "omit",
				presentation: { label: "模型（可选）", order: 20 },
			},
		},
		steps: [
			{
				stepId: "stp_txt001",
				displayName: "文本生成",
				executionBinding: { kind: "capabilityProfile", profileId: profile.profileId },
				modelSelection: { source: "templateInput", inputKey: "modelChoice", defaultModelId: input.modelId },
				inputBindings: {
					prompt: {
						source: "composeValue",
						compose: {
							kind: "concat",
							separator: "\n\n",
							parts: [
								{ source: "literal", literal: instruction },
								{ source: "templateInput", inputKey: "prompt" },
							],
						},
					},
				},
			},
		],
		workbook: { sampleRows: [{ values: { prompt: samplePrompt } }] },
	}
}

export function parseAdvancedCreatorSpec(json: string): Record<string, unknown> {
	let parsed: unknown
	try {
		parsed = JSON.parse(json)
	} catch {
		throw new Error("高级模板必须是有效的 JSON。")
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("高级模板的顶层必须是 JSON 对象。")
	}
	return parsed as Record<string, unknown>
}
