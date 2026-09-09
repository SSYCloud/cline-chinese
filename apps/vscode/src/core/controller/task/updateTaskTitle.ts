import { Empty } from "@shared/proto/cline/common"
import { TaskTitleRequest } from "@shared/proto/cline/task"
import { Logger } from "@/shared/services/Logger"
import { Controller } from "../"

/**
 * Updates the title of a task in history.
 * @param controller The controller instance
 * @param request The request containing the task ID and the new title
 * @returns Empty response
 */
export async function updateTaskTitle(controller: Controller, request: TaskTitleRequest): Promise<Empty> {
	if (!request.taskId) {
		Logger.error(`[updateTaskTitle] Invalid request: taskId missing`)
		return Empty.create({})
	}

	try {
		await controller.updateTaskTitle(request.taskId, request.title)
		return Empty.create({})
	} catch (error) {
		Logger.error("Error in updateTaskTitle:", error)
		throw error
	}
}
