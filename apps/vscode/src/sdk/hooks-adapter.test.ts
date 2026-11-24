// Hook-execution telemetry only fires when the adapter passes a task id into
// HookFactory.create (StdioHookRunner gates every captureHookExecution on it),
// so these tests pin the id threading at every adapter call site.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildAgentHooks } from "./hooks-adapter"

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
}))

vi.mock("@/core/hooks/hook-factory", () => ({
	HookFactory: class {
		create = mocks.create
	},
}))

function makeRunner() {
	return {
		isNoOp: false,
		run: vi.fn(async () => ({ cancel: false, contextModification: "", errorMessage: "" })),
	}
}

const snapshot = {
	conversationId: "conv-1",
	runId: "run-1",
	agentId: "agent-1",
	messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
} as never

const stateManager = { getGlobalSettingsKey: vi.fn(() => true) } as never

describe("hooks-adapter task id threading", () => {
	let runner: ReturnType<typeof makeRunner>

	beforeEach(() => {
		mocks.create.mockReset()
		runner = makeRunner()
		mocks.create.mockResolvedValue(runner)
	})

	it("falls back to the run id when the snapshot has no conversation id", async () => {
		const hooks = buildAgentHooks(stateManager)
		await hooks.beforeTool?.({
			toolCall: { toolName: "read_file" },
			input: {},
			snapshot: { ...(snapshot as object), conversationId: undefined },
		} as never)

		expect(mocks.create).toHaveBeenCalledWith("PreToolUse", "run-1", "read_file")
	})
})
