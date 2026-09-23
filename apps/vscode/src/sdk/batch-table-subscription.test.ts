import type { BatchSession, BatchTableSnapshot } from "@shared/loomloom"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Controller } from "@/core/controller"
import { subscribeBatchTable } from "@/core/controller/loomLoom/subscribeBatchTable"
import { BatchService } from "@/services/loomloom/batch-service"
import type { BatchApi } from "@/services/loomloom/client"

vi.mock("@/core/controller/grpc-handler", () => ({ getRequestRegistry: () => ({ registerRequest: vi.fn() }) }))

const services: BatchService[] = []
afterEach(() => {
	for (const service of services.splice(0)) service.dispose()
})

function session(taskId: string): BatchSession {
	return {
		version: 1,
		id: `batch-${taskId}`,
		taskId,
		enabled: true,
		revision: 1,
		phase: "collecting",
		rows: [],
		results: [],
		artifacts: [],
		events: [],
	}
}

describe("task-pinned Batch table permissions", () => {
	it("streams a local Agent creator-draft update to the same task-pinned worksheet", async () => {
		const batch = new BatchService({ loadAll: async () => [session("A")], save: async () => {} }, {} as BatchApi, vi.fn())
		services.push(batch)
		let creatorUpdate: ((event: { draft: Record<string, unknown>; updatedAt: number }) => void) | undefined
		const controller = {
			batch,
			task: { taskId: "A" },
			creator: {
				subscribeDraft: (_taskId: string, listener: typeof creatorUpdate) => {
					creatorUpdate = listener
					return () => {
						creatorUpdate = undefined
					}
				},
			},
		}
		const updates: Array<Record<string, unknown>> = []
		await subscribeBatchTable(
			controller as unknown as Controller,
			{ value: JSON.stringify({ taskId: "A" }) },
			async (response) => {
				updates.push(JSON.parse(response.value))
			},
		)
		creatorUpdate?.({ draft: { name: "Cline 改好了" }, updatedAt: 123 })
		await vi.waitFor(() =>
			expect(updates.at(-1)).toMatchObject({
				kind: "creator",
				draft: { name: "Cline 改好了" },
				updatedAt: 123,
				editable: true,
			}),
		)
	})
	it("sends only the latest lightweight selection while the editor is busy", async () => {
		const batch = new BatchService({ loadAll: async () => [session("A")], save: async () => {} }, {} as BatchApi, vi.fn())
		services.push(batch)
		const controller = { batch, task: { taskId: "A" } as { taskId: string } | undefined }
		const updates: Array<BatchTableSnapshot | { kind: "view"; worksheet: { range: string }; editable: boolean }> = []
		let release!: () => void
		await subscribeBatchTable(
			controller as unknown as Controller,
			{ value: JSON.stringify({ taskId: "A" }) },
			async (response) => {
				updates.push(JSON.parse(response.value))
				if (updates.length === 2) await new Promise<void>((resolve) => (release = resolve))
			},
		)
		controller.task = undefined
		batch.notifyActiveTaskChanged("A", undefined)
		await vi.waitFor(() => expect(updates.length).toBe(2))
		await batch.updateWorksheet("A", { sheet: "current", range: "C2" })
		await batch.updateWorksheet("A", { sheet: "current", range: "D3" })
		await batch.updateWorksheet("A", { sheet: "current", range: "E4" })
		release()
		await vi.waitFor(() => expect(updates.length).toBe(3))
		expect(updates[2]).toMatchObject({ kind: "view", worksheet: { range: "E4" }, editable: false })
		expect((updates[2] as { session?: unknown }).session).toBeUndefined()
	})
	it("publishes old/new editability immediately on task selection and clear without saving or toggling modes", async () => {
		const save = vi.fn(async () => {})
		const batch = new BatchService({ loadAll: async () => [session("A"), session("B")], save }, {} as BatchApi, vi.fn())
		services.push(batch)
		const controller = { batch, task: { taskId: "A" } as { taskId: string } | undefined }
		const updatesA: BatchTableSnapshot[] = [],
			updatesB: BatchTableSnapshot[] = []
		for (const [taskId, updates] of [
			["A", updatesA],
			["B", updatesB],
		] as const) {
			await subscribeBatchTable(
				controller as unknown as Controller,
				{ value: JSON.stringify({ taskId }) },
				async (response) => {
					updates.push(JSON.parse(response.value))
				},
			)
		}
		expect(updatesA.at(-1)?.editable).toBe(true)
		expect(updatesB.at(-1)?.editable).toBe(false)
		controller.task = { taskId: "B" }
		batch.notifyActiveTaskChanged("A", "B")
		await vi.waitFor(() => {
			expect(updatesA.at(-1)?.editable).toBe(false)
			expect(updatesB.at(-1)?.editable).toBe(true)
		})
		controller.task = undefined
		batch.notifyActiveTaskChanged("B", undefined)
		await vi.waitFor(() => expect(updatesB.at(-1)?.editable).toBe(false))
		expect(updatesA.at(-1)?.session?.enabled).toBe(true)
		expect(updatesB.at(-1)?.session?.enabled).toBe(true)
		expect(save).not.toHaveBeenCalled()
	})

	it("computes permissions at delivery even if a task changes while an update is queued", async () => {
		const batch = new BatchService({ loadAll: async () => [session("A")], save: async () => {} }, {} as BatchApi, vi.fn())
		services.push(batch)
		const controller = { batch, task: { taskId: "A" } }
		const updates: BatchTableSnapshot[] = []
		await subscribeBatchTable(
			controller as unknown as Controller,
			{ value: JSON.stringify({ taskId: "A" }) },
			async (response) => {
				updates.push(JSON.parse(response.value))
			},
		)
		batch.notifyActiveTaskChanged(undefined, "A")
		controller.task = { taskId: "B" }
		await vi.waitFor(() => expect(updates.at(-1)?.editable).toBe(false))
	})
})
