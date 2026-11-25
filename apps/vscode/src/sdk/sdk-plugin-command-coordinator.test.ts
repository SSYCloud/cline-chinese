import { beforeEach, describe, expect, it, vi } from "vitest"

const listFunctionCommands = vi.fn()
vi.mock("@cline/core", () => ({
	listClaudePluginFunctionCommands: (options: unknown) => listFunctionCommands(options),
}))
vi.mock("@/shared/services/Logger", () => ({
	Logger: { debug: vi.fn(), error: vi.fn(), log: vi.fn(), warn: vi.fn() },
}))

import { SdkPluginCommandCoordinator } from "./sdk-plugin-command-coordinator"

function makeCoordinator() {
	const infos: string[] = []
	const coordinator = new SdkPluginCommandCoordinator({
		stateManager: {
			getSecretKey: (key: string) => (key === "typesafeApiKey" ? "sk-test" : ""),
			getGlobalSettingsKey: () => undefined,
		} as never,
		sessions: { getActiveSession: () => undefined } as never,
		messages: { appendAndEmit: (messages: Array<{ text: string }>) => infos.push(messages[0].text) } as never,
		getDisplayedTaskId: () => "task-1",
		getWorkspaceRoot: async () => "/work",
		postStateToWebview: async () => {},
	})
	return { coordinator, infos }
}

describe("SdkPluginCommandCoordinator", () => {
	beforeEach(() => {
		listFunctionCommands.mockReset()
	})

	it("runs the named command with its arguments, passes SystemOne settings to the plugin, and shows the reply", async () => {
		const handler = vi.fn().mockResolvedValue({ reply: "pruned 3 tests" })
		listFunctionCommands.mockResolvedValue([{ name: "prune-comments", handler }])
		const { coordinator, infos } = makeCoordinator()

		await coordinator.run("/prune-comments all")

		expect(handler).toHaveBeenCalledWith("all")
		expect(listFunctionCommands).toHaveBeenCalledWith(
			expect.objectContaining({
				cwd: "/work",
				pluginOptions: {
					"fast-jev-compaction": expect.objectContaining({
						apiKey: "sk-test",
						baseUrl: "https://router.shengsuanyun.com/api/v1/decisions",
					}),
				},
			}),
		)
		expect(infos.at(-1)).toBe("pruned 3 tests")
	})

	it("tells the user when no installed plugin provides the command", async () => {
		listFunctionCommands.mockResolvedValue([])
		const { coordinator, infos } = makeCoordinator()

		await coordinator.run("/prune-tests")

		expect(infos).toEqual(["未找到插件命令 /prune-tests。请确认插件已安装并重启会话。"])
	})

	it("reports a handler failure in the chat instead of throwing", async () => {
		listFunctionCommands.mockResolvedValue([{ name: "prune-tests", handler: vi.fn().mockRejectedValue(new Error("boom")) }])
		const { coordinator, infos } = makeCoordinator()

		await coordinator.run("/prune-tests")

		expect(infos.at(-1)).toBe("/prune-tests 失败：boom")
	})
})
