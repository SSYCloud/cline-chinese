import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { z } from "zod"
import type { Controller } from "../index"
export async function openBatchTable(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const { taskId } = z.object({ taskId: z.string().min(1).max(200) }).parse(JSON.parse(request.value))
	if (!(await controller.batch.snapshot(taskId))) throw new Error("没有找到此任务的 Batch 数据。")
	if (!controller.batchTableHost) throw new Error("独立 Batch 表格目前需要 VS Code 编辑器。")
	await controller.batchTableHost.open(taskId)
	return StringResponse.create({ value: "{}" })
}
