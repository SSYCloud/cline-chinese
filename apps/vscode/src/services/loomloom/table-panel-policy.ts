import type { GrpcRequest } from "@shared/WebviewMessage"

const METHODS = new Set([
	"subscribeBatchTable",
	"getBatchTableSnapshot",
	"batchCommand",
	"creatorCommand",
	"batchModels",
	"selectBatchAttachment",
	"batchTableAction",
	"worksheetOperation",
])
// These are explicit human UI commands routed through the same BatchService as
// the chat card. Agent table tools use a separate, non-paid operation allowlist.
const USER_ACTIONS = new Set([
	"patch",
	"removeAttachment",
	"review",
	"revise",
	"quote",
	"execute",
	"refreshRun",
	"recoverRun",
	"newBatch",
	"addRows",
	"removeRows",
])
/** A table is a task-pinned view, not a second general-purpose webview/Controller. */
export function validateBatchTableRequest(taskId: string, request: GrpcRequest): void {
	if (request.service !== "cline.LoomLoomService" || !METHODS.has(request.method)) throw new Error("表格页不支持此操作。")
	if (typeof request.message?.value !== "string" || request.message.value.length > 1_000_000)
		throw new Error("无效的表格请求。")
	const input = JSON.parse(request.message.value)
	if (input.taskId !== taskId) throw new Error("表格固定到原任务，不能操作其他会话。")
	if (request.method === "batchCommand" && !USER_ACTIONS.has(input.command?.action))
		throw new Error("工作表不支持此命令，请在 Cline 对话中选择 SkillBot 或切换模式。")
	if (request.method === "creatorCommand" && typeof input.command?.action !== "string") throw new Error("创建模式命令无效。")
	if (request.is_streaming !== (request.method === "subscribeBatchTable")) throw new Error("请求类型不正确。")
}
