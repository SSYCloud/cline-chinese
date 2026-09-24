import type { BatchCommand, BatchInputContext, BatchSession, SkillBot } from "@shared/loomloom"
import { StringRequest } from "@shared/proto/cline/common"
import { LoomLoomServiceClient } from "@/services/grpc-client"

export async function sendBatch(command: BatchCommand, taskId?: string): Promise<BatchSession | null> {
	const result = await LoomLoomServiceClient.batchCommand(StringRequest.create({ value: JSON.stringify({ taskId, command }) }))
	return JSON.parse(result.value)
}
export interface SkillBotPage {
	items: SkillBot[]
	installedIds: string[]
	authRequired?: boolean
	pages?: number
	nextPageToken?: string
}
export async function fetchSkillBots(input: {
	installed?: boolean
	page?: number
	keyword?: string
	pageToken?: string
	action?: "pin" | "unpin"
	id?: string
}): Promise<SkillBotPage> {
	return JSON.parse((await LoomLoomServiceClient.skillBotCatalog(StringRequest.create({ value: JSON.stringify(input) }))).value)
}

export async function attachToRow(session: BatchInputContext, rowId: string, field?: string) {
	return LoomLoomServiceClient.selectBatchAttachment(
		StringRequest.create({ value: JSON.stringify({ taskId: session.taskId, revision: session.revision, rowId, field }) }),
	)
}
