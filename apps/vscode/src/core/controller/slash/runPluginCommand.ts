import { Empty, StringRequest } from "@shared/proto/cline/common"
import type { Controller } from ".."

export async function runPluginCommand(controller: Controller, request: StringRequest): Promise<Empty> {
	await controller.runPluginSlashCommand(request.value)
	return Empty.create()
}
