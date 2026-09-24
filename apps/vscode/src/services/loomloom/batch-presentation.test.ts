import { afterEach, describe, expect, it } from "bun:test"
import type { BatchSession, SkillBot } from "@shared/loomloom"
import { BatchPresentationCoordinator } from "./batch-presentation"
import { BatchService, type BatchStore } from "./batch-service"
import type { BatchApi } from "./client"

const listing: SkillBot = {
	id: "listing",
	name: "测试批量输入",
	description: "",
	versionId: "v1",
	availability: "available",
	fee: { amount: "0.10", currency: "CNY" },
	schema: {
		schema_version: "loom_market_public_input_schema_v1",
		fields: [{ key: "text", label: "原文", required: true, value_type: "string" }],
	},
}
const disposables: { dispose(): void }[] = []
afterEach(() => {
	for (const disposable of disposables.splice(0)) disposable.dispose()
})

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((done) => {
		resolve = done
	})
	return { promise, resolve }
}

function setup() {
	let currentTask: string | undefined = "task"
	let persisted: BatchSession[] = []
	let quoteCalls = 0
	let executeCalls = 0
	const opened: { taskId: string; preserveFocus: boolean; sheet?: string; range?: string }[] = []
	const failures: unknown[] = []
	const store: BatchStore = {
		loadAll: async () => [],
		save: async (session) => {
			persisted = [...persisted.filter((item) => item.taskId !== session.taskId), structuredClone(session)]
		},
	}
	const api: BatchApi = {
		detail: async () => structuredClone(listing),
		quote: async (_id, _version, rows) => {
			quoteCalls++
			return {
				taskCount: rows.length,
				listingVersionId: "v1",
				estimatedBuyerPayable: { amount: "0.20", currency: "CNY" },
			}
		},
		execute: async () => {
			executeCalls++
			return { runId: "run-1" }
		},
		run: async () => ({
			status: "running",
			total: 2,
			completed: 1,
			failed: 0,
			rows: [{ rowIndex: 0, status: "completed" }],
			artifacts: [],
			listingId: "listing",
		}),
	}
	const batch = new BatchService(store, api, () => {}, 60_000)
	const host = {
		currentTask: () => currentTask,
		open: async (taskId: string, preserveFocus: boolean) => {
			const session = await batch.snapshot(taskId)
			opened.push({ taskId, preserveFocus, sheet: session?.worksheet?.sheet, range: session?.worksheet?.range })
		},
		onError: (error: unknown) => failures.push(error),
	}
	const presentation = new BatchPresentationCoordinator(batch, host)
	disposables.push(presentation, batch)
	const snapshot = async () => (await batch.snapshot("task"))!
	async function rows(actor: "user" | "agent" = "user", taskId = "task") {
		await batch.setEnabled(taskId, true)
		const selected = await batch.command(taskId, { action: "select", listingId: "listing" }, actor)
		const session = await batch.command(taskId, { action: "quantity", revision: selected.revision, count: 2 }, actor)
		await presentation.whenIdle()
		return session
	}
	async function quoted() {
		const session = await rows()
		const patched = await batch.command("task", {
			action: "patch",
			revision: session.revision,
			rows: session.rows.map((row) => ({ id: row.id, values: { text: "测试" } })),
		})
		await batch.command("task", { action: "review", revision: patched.revision })
		await presentation.whenIdle()
		return batch.command("task", { action: "quote", revision: patched.revision })
	}
	return {
		api,
		batch,
		store,
		host,
		presentation,
		opened,
		failures,
		snapshot,
		rows,
		quoted,
		setCurrentTask: (taskId: string | undefined) => {
			currentTask = taskId
		},
		persisted: () => persisted,
		calls: () => ({ quote: quoteCalls, execute: executeCalls }),
	}
}

describe("automatic shared Batch worksheet presentation", () => {
	it("restores an already-enabled conversation without changing its saved input selection", async () => {
		const f = setup()
		await f.rows()
		await f.batch.updateWorksheet("task", { sheet: "current", range: "D3", zoom: 110, wrap: false })
		f.opened.length = 0
		f.setCurrentTask("other")
		f.presentation.activateTask("other")
		f.setCurrentTask("task")
		f.presentation.activateTask("task")
		await f.presentation.whenIdle()
		expect(f.opened).toEqual([{ taskId: "task", preserveFocus: true, sheet: "current", range: "D3" }])
		expect((await f.snapshot()).worksheet).toEqual({ sheet: "current", range: "D3", zoom: 110, wrap: false })
		expect(f.calls()).toEqual({ quote: 0, execute: 0 })
	})

	it("preserves a valid history sheet while returning to a task with an empty new batch", async () => {
		const f = setup()
		const quote = await f.quoted()
		await f.batch.command("task", { action: "execute", revision: quote.revision, quoteId: quote.quote!.id })
		const run = await f.api.run("run-1")
		f.api.run = async () => ({ ...run, status: "completed", completed: 2 })
		await f.batch.command("task", { action: "refreshRun" })
		await f.batch.command("task", { action: "newBatch" })
		await f.presentation.whenIdle()
		await f.batch.updateWorksheet("task", { sheet: "history:run-1", range: "D2", zoom: 110 })
		f.opened.length = 0
		f.presentation.activateTask("task")
		await f.presentation.whenIdle()
		expect(f.opened).toEqual([{ taskId: "task", preserveFocus: true, sheet: "history:run-1", range: "D2" }])
	})

	it("falls back to current inputs when the restored history sheet no longer exists", async () => {
		const f = setup()
		await f.rows()
		await f.batch.updateWorksheet("task", { sheet: "history:missing", range: "D8", zoom: 110 })
		f.opened.length = 0
		f.presentation.activateTask("task")
		await f.presentation.whenIdle()
		expect(f.opened).toEqual([{ taskId: "task", preserveFocus: true, sheet: "current", range: "C2" }])
		expect((await f.snapshot()).worksheet?.zoom).toBe(110)
	})

	it("does not open an empty, disabled or unrelated task on activation", async () => {
		const f = setup()
		await f.batch.setEnabled("task", true)
		f.presentation.activateTask("task")
		await f.presentation.whenIdle()
		expect(f.opened).toHaveLength(0)
		await f.rows()
		await f.batch.setEnabled("task", false)
		f.opened.length = 0
		f.presentation.activateTask("task")
		await f.presentation.whenIdle()
		f.presentation.activateTask("other")
		await f.presentation.whenIdle()
		expect(f.opened).toHaveLength(0)
	})

	for (const interruption of ["switch", "clear", "dispose"] as const) {
		it(`drops a task activation when ${interruption} happens during snapshot loading`, async () => {
			const f = setup()
			await f.rows()
			f.opened.length = 0
			const entered = deferred(),
				released = deferred()
			const snapshot = f.batch.snapshot.bind(f.batch)
			f.batch.snapshot = async (taskId) => {
				entered.resolve()
				await released.promise
				return snapshot(taskId)
			}
			f.presentation.activateTask("task")
			await entered.promise
			if (interruption === "dispose") f.presentation.dispose()
			else {
				const taskId = interruption === "clear" ? undefined : "other"
				f.setCurrentTask(taskId)
				f.presentation.activateTask(taskId)
			}
			released.resolve()
			await f.presentation.whenIdle()
			expect(f.opened).toHaveLength(0)
		})
	}

	it("opens only the latest activation across rapid A-B-A selection", async () => {
		const f = setup()
		await f.rows()
		f.opened.length = 0
		f.presentation.activateTask("task")
		f.setCurrentTask("other")
		f.presentation.activateTask("other")
		f.setCurrentTask("task")
		f.presentation.activateTask("task")
		await f.presentation.whenIdle()
		expect(f.opened).toHaveLength(1)
	})

	for (const actor of ["user", "agent"] as const) {
		it(`opens the current input once after ${actor} sets quantity, without purchasing`, async () => {
			const f = setup()
			await f.rows(actor)
			expect(f.opened).toEqual([{ taskId: "task", preserveFocus: true, sheet: "current", range: "C2" }])
			expect(f.persisted()[0].rows).toHaveLength(2)
			expect(f.calls()).toEqual({ quote: 0, execute: 0 })
			const session = await f.snapshot()
			await f.batch.command(
				"task",
				{
					action: "patch",
					revision: session.revision,
					rows: [{ id: session.rows[0].id, values: { text: "输入编辑" } }],
				},
				actor,
			)
			await f.presentation.whenIdle()
			expect(f.opened).toHaveLength(1)
		})
	}

	it("review and revise select current inputs even when a history sheet was selected", async () => {
		const f = setup()
		const session = await f.quoted()
		for (const action of ["review", "revise"] as const) {
			await f.batch.updateWorksheet("task", { sheet: "history:old", range: "D8", zoom: 110, wrap: false })
			await f.batch.command("task", { action, revision: (await f.snapshot()).revision }, "agent")
			await f.presentation.whenIdle()
			expect((await f.snapshot()).worksheet).toEqual({ sheet: "current", range: "C2", zoom: 110, wrap: false })
			expect(f.opened.at(-1)).toEqual({ taskId: "task", preserveFocus: true, sheet: "current", range: "C2" })
		}
		expect((await f.snapshot()).quote?.valid).toBe(false)
		expect((await f.snapshot()).quote?.id).toBe(session.quote!.id)
		expect(f.calls()).toEqual({ quote: 1, execute: 0 })
	})

	it("opens progress on run creation and never reopens a closed view on polling", async () => {
		const f = setup()
		const session = await f.quoted()
		f.opened.length = 0
		await f.batch.command("task", { action: "execute", revision: session.revision, quoteId: session.quote!.id })
		await f.presentation.whenIdle()
		expect(f.opened).toEqual([{ taskId: "task", preserveFocus: true, sheet: "progress", range: "B2" }])
		// Closing the native view does not change the domain state or produce another intent.
		f.opened.length = 0
		await f.batch.command("task", { action: "refreshRun" })
		const running = await f.api.run("run-1")
		f.api.run = async () => ({ ...running, status: "completed", completed: 2 })
		await f.batch.command("task", { action: "refreshRun" })
		await f.presentation.whenIdle()
		expect((await f.snapshot()).phase).toBe("completed")
		expect(f.opened).toHaveLength(0)
		expect(f.calls()).toEqual({ quote: 1, execute: 1 })
	})

	it("opens progress only after an uncertain submission is explicitly recovered", async () => {
		const f = setup()
		const session = await f.quoted()
		f.api.execute = async () => {
			throw new Error("connection lost")
		}
		f.opened.length = 0
		await f.batch.command("task", { action: "execute", revision: session.revision, quoteId: session.quote!.id })
		await f.presentation.whenIdle()
		expect(f.opened).toHaveLength(0)
		await f.batch.command("task", { action: "recoverRun", runId: "run-1" })
		await f.presentation.whenIdle()
		expect(f.opened).toEqual([{ taskId: "task", preserveFocus: true, sheet: "progress", range: "B2" }])
	})

	it("resumes inputs or progress when re-entering Batch, but not on repeated enable", async () => {
		const f = setup()
		const session = await f.quoted()
		for (const executed of [false, true]) {
			if (executed) {
				await f.batch.command("task", { action: "execute", revision: session.revision, quoteId: session.quote!.id })
				await f.presentation.whenIdle()
			}
			await f.batch.setEnabled("task", false)
			await f.batch.updateWorksheet("task", { sheet: "history:old", range: "A1" })
			f.opened.length = 0
			await f.batch.setEnabled("task", true)
			await f.presentation.whenIdle()
			expect(f.opened).toEqual([
				{
					taskId: "task",
					preserveFocus: true,
					sheet: executed ? "progress" : "current",
					range: executed ? "B2" : "C2",
				},
			])
			await f.batch.setEnabled("task", true)
			await f.presentation.whenIdle()
			expect(f.opened).toHaveLength(1)
		}
	})

	it("never opens for another task", async () => {
		const f = setup()
		await f.rows("agent", "old-task")
		expect(f.opened).toHaveLength(0)
		expect((await f.batch.snapshot("old-task"))?.worksheet).toBeUndefined()
	})

	for (const interruption of ["task switch", "disabled", "new batch", "disposed"] as const) {
		it(`drops a queued presentation after ${interruption}`, async () => {
			const f = setup()
			const entered = deferred()
			const released = deferred()
			const updateWorksheet = f.batch.updateWorksheet.bind(f.batch)
			f.batch.updateWorksheet = async (...args) => {
				entered.resolve()
				await released.promise
				return updateWorksheet(...args)
			}
			await f.batch.setEnabled("task", true)
			const selected = await f.batch.command("task", { action: "select", listingId: "listing" })
			await f.batch.command("task", { action: "quantity", revision: selected.revision, count: 2 })
			await entered.promise
			if (interruption === "task switch") f.setCurrentTask("another-task")
			if (interruption === "disabled") await f.batch.setEnabled("task", false)
			if (interruption === "new batch") await f.batch.command("task", { action: "newBatch" })
			if (interruption === "disposed") f.presentation.dispose()
			released.resolve()
			await f.presentation.whenIdle()
			// The old selection must be dropped. A new batch emits its own valid
			// presentation intent and should open the new input sheet once.
			expect(f.opened).toHaveLength(interruption === "new batch" ? 1 : 0)
			if (interruption === "new batch")
				expect(f.opened[0]).toEqual({ taskId: "task", preserveFocus: true, sheet: "current", range: "C2" })
			expect((await f.snapshot()).worksheet).toEqual(
				interruption === "new batch" ? { sheet: "current", range: "C2" } : undefined,
			)
		})
	}

	it("rechecks the current task after updating selection and before native open", async () => {
		const f = setup()
		const updateWorksheet = f.batch.updateWorksheet.bind(f.batch)
		f.batch.updateWorksheet = async (...args) => {
			const result = await updateWorksheet(...args)
			f.setCurrentTask("another-task")
			return result
		}
		await f.rows()
		expect(f.opened).toHaveLength(0)
	})

	it("unsubscribes on disposal", async () => {
		const f = setup()
		f.presentation.dispose()
		await f.rows()
		expect(f.opened).toHaveLength(0)
	})

	it("does not emit an intent when persistence fails", async () => {
		const f = setup()
		await f.batch.setEnabled("task", true)
		f.store.save = async () => {
			throw new Error("disk full")
		}
		// Selection emits an intent only after its state has been persisted.
		await expect(f.batch.command("task", { action: "select", listingId: "listing" })).rejects.toThrow("disk full")
		await f.presentation.whenIdle()
		expect(f.opened).toHaveLength(0)
	})

	it("logs native failures without changing successful paid execution or blocking later commands", async () => {
		const f = setup()
		const session = await f.quoted()
		f.host.open = async () => {
			throw new Error("native view unavailable")
		}
		const submitted = await f.batch.command("task", {
			action: "execute",
			revision: session.revision,
			quoteId: session.quote!.id,
		})
		await f.presentation.whenIdle()
		expect(f.failures).toHaveLength(1)
		expect(submitted.phase).toBe("running")
		expect((await f.snapshot()).attempt).toEqual(submitted.attempt)
		expect((await f.snapshot()).error).toBeUndefined()
		expect(f.persisted()[0].phase).toBe("running")
		await f.batch.command("task", { action: "refreshRun" })
		expect(f.calls()).toEqual({ quote: 1, execute: 1 })
	})

	it("does not hold the domain lock while a native view is opening", async () => {
		const f = setup()
		const entered = deferred()
		const released = deferred()
		f.host.open = async () => {
			entered.resolve()
			await released.promise
		}
		await f.batch.setEnabled("task", true)
		const selected = await f.batch.command("task", { action: "select", listingId: "listing" })
		const session = await f.batch.command("task", { action: "quantity", revision: selected.revision, count: 2 })
		await entered.promise
		const patched = await f.batch.command("task", {
			action: "patch",
			revision: session.revision,
			rows: [{ id: session.rows[0].id, values: { text: "仍可编辑" } }],
		})
		expect(patched.rows[0].values.text).toBe("仍可编辑")
		released.resolve()
		await f.presentation.whenIdle()
	})
})
