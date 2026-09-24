import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { parseCreatorCommand } from "@/services/loomloom/creator-service"
import type { Controller } from "../index"

/** Task-scoped creator actions share the existing Controller credential and conversation. */
export async function creatorCommand(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const input = parseCreatorCommand(request.value)
	const localDraft = input.command.action === "loadDraft" || input.command.action === "saveDraft"
	if (!localDraft && input.taskId !== controller.task?.taskId) throw new Error("会话已切换，请在原 Batch 对话中重试。")
	const session = await controller.batch.snapshot(input.taskId)
	if (!session || (!localDraft && !session.enabled)) throw new Error("请先进入当前会话的 Batch 模式。")
	return StringResponse.create({ value: JSON.stringify(await controller.creator.execute(input.command, input.taskId)) })
}
