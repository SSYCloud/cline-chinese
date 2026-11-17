import { beforeEach, describe, expect, it, vi } from "vitest"
import type { StateManager } from "@/core/storage/StateManager"
import { pruneTests } from "@/services/typesafe-compaction/library"
import { createTestFileAccess } from "@/services/typesafe-compaction/test-file-access"
import { SdkCompactionCoordinator } from "./sdk-compaction-coordinator"
import { SdkInteractionCoordinator } from "./sdk-interaction-coordinator"
import { SdkMessageCoordinator } from "./sdk-message-coordinator"

vi.mock("@/services/typesafe-compaction/library", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/services/typesafe-compaction/library")>()),
	pruneTests: vi.fn(),
	JevClient: vi.fn(),
}))
vi.mock("@/services/typesafe-compaction/test-file-access", () => ({ createTestFileAccess: vi.fn() }))
vi.mock("@/services/typesafe-compaction/precompact", () => ({ createTypesafePreCompact: vi.fn() }))
vi.mock("@cline/core", () => ({ createContextCompactionPrepareTurn: vi.fn(), createSessionCompactionState: vi.fn() }))

describe("pruneTests with no task, end to end", () => {
	beforeEach(() => vi.clearAllMocks())

	it("writes the pruned files and shows the result after the user clicks 删除", async () => {
		const messages = new SdkMessageCoordinator({ getTask: () => undefined })
		const postStateToWebview = vi.fn(async () => undefined)
		const interactions = new SdkInteractionCoordinator({
			messages,
			getSessionId: () => "",
			postStateToWebview,
		})
		const real = {
			list: vi.fn().mockResolvedValue(["a.test.ts"]),
			read: vi.fn(async () => "original"),
			write: vi.fn(async () => undefined),
		}
		vi.mocked(createTestFileAccess).mockReturnValue(real as never)
		vi.mocked(pruneTests).mockImplementation(async (files) => {
			await files.write("a.test.ts", "pruned")
			return {
				files: 1,
				tests: 3,
				requests: 1,
				deleted: [{ id: "u1", file: "a.test.ts", name: "is truthy", keepTest: 0 }],
				scores: [],
			}
		})
		const coordinator = new SdkCompactionCoordinator({
			stateManager: {
				getApiConfiguration: () => ({ shengSuanYunApiKey: "k", actModeApiProvider: "shengsuanyun" }),
				getGlobalSettingsKey: () => undefined,
				getSecretKey: (key: string) => (key === "shengSuanYunApiKey" ? "k" : undefined),
			} as unknown as StateManager,
			sessions: { getActiveSession: () => undefined, waitForPendingStop: async () => undefined },
			rebuilds: { runExclusive: async (op: () => Promise<unknown>) => op() },
			messages,
			taskHistory: {},
			sessionConfigBuilder: { build: vi.fn() },
			getDisplayedTaskId: () => undefined,
			createTempSessionHost: vi.fn(),
			loadInitialMessages: vi.fn(),
			getWorkspaceRoot: async () => "/workspace",
			postStateToWebview,
			askInChat: (question: string, options: string[]) =>
				interactions.handleAskQuestion(question, options, undefined).then((a) => a as string),
			setTurnPhase: vi.fn(),
		} as never)

		const run = coordinator.pruneTests()
		await new Promise((r) => setTimeout(r, 0))
		const ask = messages.getDetachedMessages().find((m) => m.ask === "followup")
		expect(ask).toBeDefined()

		expect(interactions.resolvePendingAskQuestion("删除")).toBe(true)
		await run

		expect(real.write).toHaveBeenCalledWith("a.test.ts", "pruned")
		expect(messages.getDetachedMessages()).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ say: "info", text: "已扫描 3 个测试，删除 1 个。\n- a.test.ts › is truthy" }),
			]),
		)
	})
})
