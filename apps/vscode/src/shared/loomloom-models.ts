import type { BatchField } from "./loomloom"

export const BATCH_MODEL_STEP_TYPES = [
	"text-generate",
	"image-generate",
	"video-generate",
	"audio-generate",
	"audio-transcribe",
	"model3d-generate",
] as const

type ModelStepType = (typeof BATCH_MODEL_STEP_TYPES)[number]

// These describe public input fields, not private workflow steps or model IDs.
const PUBLIC_MODEL_FIELDS: Record<string, ModelStepType> = {
	textmodel: "text-generate",
	文本模型: "text-generate",
	文字模型: "text-generate",
	imagemodel: "image-generate",
	图片模型: "image-generate",
	图像模型: "image-generate",
	videomodel: "video-generate",
	视频模型: "video-generate",
	audiomodel: "audio-generate",
	音频模型: "audio-generate",
	语音生成模型: "audio-generate",
	audiotranscribemodel: "audio-transcribe",
	transcriptionmodel: "audio-transcribe",
	音频转写模型: "audio-transcribe",
	语音转写模型: "audio-transcribe",
	model3d: "model3d-generate",
	model3dmodel: "model3d-generate",
	"3dmodel": "model3d-generate",
	"3d模型": "model3d-generate",
	三维模型: "model3d-generate",
}

export function resolveBatchModelField(field: BatchField): {
	isModel: boolean
	stepType?: string
	allowOverride: boolean
	defaultModelId?: string
} {
	const metadata = field.model_override
	if (metadata) {
		const stepType = BATCH_MODEL_STEP_TYPES.find((step) => step === metadata.step_type)
		return {
			isModel: true,
			stepType,
			allowOverride: !!stepType && metadata.allow_override !== false,
			defaultModelId: metadata.default_model_id,
		}
	}
	const matches = new Set(
		[field.key, field.label ?? ""]
			.map((value) => {
				const key = value.toLowerCase().replace(/[\s_-]/g, "")
				return Object.hasOwn(PUBLIC_MODEL_FIELDS, key) ? PUBLIC_MODEL_FIELDS[key] : undefined
			})
			.filter((value): value is ModelStepType => !!value),
	)
	const stepType = matches.size === 1 ? [...matches][0] : undefined
	return {
		isModel: !!stepType || /model|模型/i.test(field.key + (field.label ?? "")),
		stepType,
		allowOverride: !!stepType,
	}
}

/** Public enum constraints narrow the catalog; they never add unsupported models. */
export function filterBatchFieldModels<T extends { id: string }>(field: BatchField, models: T[]): T[] {
	return field.enum_values?.length ? models.filter((model) => field.enum_values!.includes(model.id)) : models
}
