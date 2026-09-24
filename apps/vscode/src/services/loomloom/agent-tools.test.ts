import { describe, expect, it } from "bun:test"
import type { AgentToolContext } from "@cline/shared"
import { createBatchTools } from "./agent-tools"
import { BatchService } from "./batch-service"
import type { BatchApi } from "./client"

describe("Batch Agent tools", () => {
	it("exposes only draft operations and rejects another or inactive session", async () => {
		const service = new BatchService({ loadAll: async () => [], save: async () => {} }, {} as BatchApi, () => {})
		await service.setEnabled("current", true)
		const tools = createBatchTools(service, () => "current")
		expect(tools.map((t) => t.name)).toEqual(["loomloom_get_context", "loomloom_update_draft", "loomloom_validate_draft"])
		const context = { sessionId: "other", conversationId: "other", agentId: "test", iteration: 1 } as AgentToolContext
		expect(await tools[0].execute({}, context)).toEqual({ error: "Batch 工具只能用于当前 Cline 会话。" })
		context.sessionId = "current"
		expect(await tools[0].execute({}, context)).toMatchObject({ taskId: "current", enabled: true })
		await service.setEnabled("current", false)
		expect(await tools[0].execute({}, context)).toEqual({ error: "当前未启用 Batch，请继续正常对话。" })
		service.dispose()
	})
})
