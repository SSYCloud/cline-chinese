import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { z } from "zod"
import type { Controller } from "../index"
export async function batchTableAction(controller: Controller, request: StringRequest): Promise<StringResponse> {
	if (request.value.length > 20_000) throw new Error("工作表引用内容过长，请缩短后重试。")
	const input = z
		.object({
			taskId: z.string().min(1).max(200),
			action: z.enum(["focusChat", "openArtifact", "saveOutputs", "cite"]),
			text: z.string().max(15_000).optional(),
			runId: z.string().max(200).optional(),
			rowIndex: z.number().int().min(0).optional(),
			artifactIndex: z.number().int().min(0).optional(),
		})
		.parse(JSON.parse(request.value))
	if (input.action === "cite" && input.taskId !== controller.task?.taskId)
		throw new Error("请先打开原任务，再将创作草稿交给 Cline。")
	if (!controller.batchTableHost) throw new Error("此操作需要 VS Code。")
	await controller.batchTableHost.action(input)
	return StringResponse.create({ value: "{}" })
}
