import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { parseBatchCommand } from "@/services/loomloom/commands"
import type { Controller } from "../index"

export async function batchCommand(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const input = parseBatchCommand(request.value)
	if (input.taskId && input.taskId !== controller.task?.taskId) throw new Error("会话已切换，请在当前任务重试。")
	if (input.command.action === "mode") await controller.setProductAgentMode(input.command.mode)
	else {
		if (!input.taskId || !controller.task?.taskId) throw new Error("请先进入当前会话的 Batch 模式。")
		await controller.batch.command(input.taskId, input.command)
	}
	return StringResponse.create({ value: JSON.stringify((await controller.batch.snapshot(controller.task?.taskId)) ?? null) })
}
