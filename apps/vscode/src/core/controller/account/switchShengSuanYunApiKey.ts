import { Empty, type StringRequest } from "@shared/proto/cline/common"
import type { Controller } from "../index"

export async function switchShengSuanYunApiKey(controller: Controller, request: StringRequest): Promise<Empty> {
	await controller.switchShengSuanYunApiKey(request.value)
	return Empty.create({})
}
