import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { z } from "zod"
import type { Controller } from "../index"
export async function worksheetOperation(controller: Controller, request: StringRequest): Promise<StringResponse> {
	if (request.value.length > 1_000_000) throw new Error("工作表操作过大，请缩小选区。")
	const input = z.object({ taskId: z.string().min(1).max(200), operation: z.unknown() }).parse(JSON.parse(request.value))
	return StringResponse.create({ value: JSON.stringify(await controller.batchTable.execute(input.taskId, input.operation)) })
}
