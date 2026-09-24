import { filterBatchFieldModels, resolveBatchModelField } from "@shared/loomloom-models"
import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { z } from "zod"
import type { Controller } from "../index"
export async function batchModels(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const input = z.object({ taskId: z.string(), field: z.string() }).parse(JSON.parse(request.value))
	if (input.taskId !== controller.task?.taskId) throw new Error("会话已切换。")
	const session = await controller.batch.snapshot(input.taskId)
	const field = session?.listing?.schema?.fields.find((f) => f.key === input.field)
	const model = field && resolveBatchModelField(field)
	if (!field || !model?.stepType || !model.allowOverride) return StringResponse.create({ value: "[]" })
	return StringResponse.create({
		value: JSON.stringify(filterBatchFieldModels(field, await controller.loomLoom.models(model.stepType))),
	})
}
