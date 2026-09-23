import type { BatchTableSnapshot } from "@shared/loomloom"
import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { z } from "zod"
import type { Controller } from "../index"
export async function getBatchTableSnapshot(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const { taskId, refreshRunId } = z
		.object({ taskId: z.string().min(1).max(200), refreshRunId: z.string().min(1).max(200).optional() })
		.parse(JSON.parse(request.value))
	if (refreshRunId) {
		const current = await controller.batch.snapshot(taskId)
		if (current?.attempt?.runId === refreshRunId) await controller.batch.command(taskId, { action: "refreshRun" })
		else await controller.batch.refreshHistory(taskId, refreshRunId)
	}
	const snapshot: BatchTableSnapshot = {
		session: (await controller.batch.snapshot(taskId)) ?? null,
		editable: controller.task?.taskId === taskId,
	}
	return StringResponse.create({ value: JSON.stringify(snapshot) })
}
