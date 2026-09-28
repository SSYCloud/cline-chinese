import { afterEach, describe, expect, it } from "bun:test"
import path from "node:path"
import { type BatchSession, canonicalRows, effectiveTaskCount, parseBatchSchema, type SkillBot } from "@shared/loomloom"
import { BatchService, type BatchStore } from "./batch-service"
import { type BatchApi, LoomLoomClient } from "./client"
import { parseBatchCommand } from "./commands"

const listing: SkillBot = {
	id: "listing",
	name: "测试扩写",
	description: "",
	versionId: "v1",
	availability: "available",
	fee: { amount: "0.10", currency: "CNY" },
	schema: {
		schema_version: "loom_market_public_input_schema_v1",
		fields: [
			{ key: "text", label: "原文", required: true, value_type: "string" },
			{ key: "count", value_type: "integer" },
			{ key: "model", value_type: "string" },
		],
	},
}
const services: BatchService[] = []
afterEach(() => {
	for (const service of services) service.dispose()
	services.length = 0
})
function setup(initial: BatchSession[] = []) {
	let persisted = initial.map((s) => structuredClone(s))
	const executed: { requestId: string; rows: unknown }[] = []
	const store: BatchStore = {
		loadAll: async () => structuredClone(persisted),
		save: async (s) => {
			persisted = [...persisted.filter((p) => p.taskId !== s.taskId), structuredClone(s)]
		},
	}
	const api: BatchApi = {
		detail: async () => structuredClone(listing),
		quote: async (_id, _version, rows) => ({
			taskCount: rows.length,
			listingVersionId: "v1",
			estimatedBuyerPayable: { amount: "0.30", currency: "CNY" },
		}),
		execute: async (_id, _version, rows, requestId) => {
			expect(persisted[0].attempt?.requestId).toBe(requestId)
			expect(persisted[0].phase).toBe("submitting")
			executed.push({ requestId, rows })
			return { runId: "run-1" }
		},
		run: async () => ({
			status: "running",
			total: 3,
			completed: 1,
			failed: 0,
			rows: [{ rowIndex: 0, status: "completed" }],
			artifacts: [],
			listingId: "listing",
		}),
	}
	const service = new BatchService(store, api, () => {}, 60_000)
	services.push(service)
	const snapshot = async () => (await service.snapshot("task"))!
	async function prepared() {
		await service.setEnabled("task", true, path.resolve("test-batch-workspace"))
		await service.command("task", { action: "select", listingId: "listing" })
		let s = await snapshot()
		await service.command("task", { action: "quantity", revision: s.revision, count: 3 })
		s = await snapshot()
		await service.command("task", {
			action: "patch",
			revision: s.revision,
			rows: s.rows.map((r, i) => ({ id: r.id, values: { text: `原文${i}`, count: "3", model: "" } })),
		})
		s = await snapshot()
		await service.command("task", { action: "review", revision: s.revision })
		return service.command("task", { action: "quote", revision: s.revision })
	}
	return { service, store, api, snapshot, prepared, executed, persisted: () => persisted }
}

describe("Batch authority and paid execution", () => {
	it("does not start a paid run without a project or an explicitly chosen output folder", async () => {
		const f = setup()
		await f.service.setEnabled("task", true)
		await f.service.command("task", { action: "select", listingId: listing.id })
		let state = await f.snapshot()
		state = await f.service.command("task", {
			action: "patch",
			revision: state.revision,
			rows: [{ id: state.rows[0].id, values: { text: "需保存的输入" } }],
		})
		state = await f.service.command("task", { action: "review", revision: state.revision })
		state = await f.service.command("task", { action: "quote", revision: state.revision })
		const before = await f.snapshot()
		await expect(
			f.service.command("task", { action: "execute", revision: state.revision, quoteId: state.quote!.id }),
		).rejects.toThrow("产物保存目录")
		const after = await f.snapshot()
		expect(after.phase).toBe("quoted")
		expect(after.quote).toEqual(before.quote)
		expect(after.revision).toBe(before.revision)
		expect(after.attempt).toBeUndefined()
		expect(f.executed).toHaveLength(0)
		const chosenFolder = path.resolve("projectless-user-choice")
		await f.service.setOutputRootDirectory("task", chosenFolder)
		await f.service.command("task", { action: "execute", revision: state.revision, quoteId: state.quote!.id })
		expect((await f.snapshot()).attempt?.outputDestination).toEqual({
			baseDirectory: chosenFolder,
			outputRootDirectory: chosenFolder,
		})
		expect(f.executed).toHaveLength(1)
	})
	it("freezes each run's output destination while allowing a different folder for future runs", async () => {
		const f = setup()
		const quoted = await f.prepared()
		const initialProject = quoted.outputDestination!.baseDirectory
		const firstRoot = path.resolve("first-user-output")
		const nextRoot = path.resolve("next-user-output")
		await f.service.setOutputRootDirectory("task", firstRoot)
		const afterChoice = await f.snapshot()
		expect(afterChoice.outputDestination).toEqual({ baseDirectory: initialProject, outputRootDirectory: firstRoot })
		expect(afterChoice.quote).toEqual(quoted.quote)
		await f.service.command("task", {
			action: "execute",
			revision: quoted.revision,
			quoteId: quoted.quote!.id,
		})
		await f.service.setOutputRootDirectory("task", nextRoot)
		const running = await f.snapshot()
		expect(running.outputDestination?.outputRootDirectory).toBe(nextRoot)
		expect(running.attempt?.outputDestination?.outputRootDirectory).toBe(firstRoot)
		expect(f.executed).toHaveLength(1)
	})
	it("rebinds only an owned run for explicit re-export and keeps earlier files untouched", async () => {
		const f = setup()
		const quoted = await f.prepared()
		await f.service.command("task", {
			action: "execute",
			revision: quoted.revision,
			quoteId: quoted.quote!.id,
		})
		await f.service.recordLocalOutputs("task", "run-1", [
			{
				runId: "run-1",
				rowIndex: 0,
				artifactIndex: 0,
				contentHash: "original",
				status: "saved",
				path: path.resolve("old-folder", "output.html"),
			},
		])
		const beforeReExport = await f.snapshot()
		const previousFutureRoot = beforeReExport.outputDestination
		const previousRunDestination = beforeReExport.attempt?.outputDestination
		const exportRoot = path.resolve("run-export")
		await f.service.rebindRunOutputDirectory("task", "run-1", exportRoot)
		await f.service.recordLocalOutputs(
			"task",
			"run-1",
			[
				{
					runId: "run-1",
					rowIndex: 0,
					artifactIndex: 0,
					contentHash: "late-old-write",
					status: "saved",
					path: path.resolve("old-folder", "output.html"),
				},
			],
			{ outputDestination: previousRunDestination },
		)
		const after = await f.snapshot()
		expect(after.attempt?.outputDestination?.outputRootDirectory).toBe(exportRoot)
		expect(after.outputDestination).toEqual(previousFutureRoot)
		await expect(f.service.rebindRunOutputDirectory("task", "foreign-run", exportRoot)).rejects.toThrow("不属于")
		expect(after.localOutputs).toEqual([])
	})
	it("replaces only the unsafe legacy chat fallback for future runs", async () => {
		const f = setup()
		const chatFallback = path.resolve("ClineUser", ".cline", "data", "workspaces", "chat")
		const project = path.resolve("actual-project")
		await f.service.setEnabled("task", true, chatFallback)
		await f.service.configureOutputDestination("task", project)
		expect((await f.snapshot()).outputDestination?.baseDirectory).toBe(project)
		await f.service.setOutputRootDirectory("task", path.resolve("custom-output"))
		await f.service.clearInternalChatOutputDestination("task")
		expect((await f.snapshot()).outputDestination?.outputRootDirectory).toBe(path.resolve("custom-output"))
	})
	it("promotes the untouched seed on explicit quantity and keeps blank explicit default tasks", async () => {
		const { service } = setup()
		await service.setEnabled("task", true)
		const selected = await service.command("task", { action: "select", listingId: listing.id })
		expect(effectiveTaskCount(selected.rows)).toBe(0)
		const three = await service.command("task", { action: "quantity", revision: selected.revision, count: 3 })
		expect(three.rows).toHaveLength(3)
		expect(three.rows.map((row) => row.sheetRowNumber)).toEqual([2, 3, 4])
		expect(three.rows.every((row) => row.origin === "explicit")).toBe(true)
		expect(effectiveTaskCount(three.rows)).toBe(3)
		const optional: SkillBot = {
			...listing,
			schema: { schema_version: "loom_market_public_input_schema_v1", fields: [{ key: "memo", value_type: "string" }] },
		}
		expect(
			canonicalRows({
				listing: optional,
				rows: [
					{ id: "auto", origin: "implicit", values: {}, attachments: [] },
					{ id: "user", origin: "explicit", values: {}, attachments: [] },
				],
			}),
		).toEqual([{}])
	})
	it("pins legacy visual row numbers before a structural removal", async () => {
		const original = setup()
		const quoted = await original.prepared()
		const legacy: BatchSession = {
			...quoted,
			phase: "collecting",
			quote: undefined,
			rows: quoted.rows.map(({ sheetRowNumber: _position, origin: _origin, ...row }) => row),
		}
		const resumed = setup([legacy])
		const next = await resumed.service.command("task", {
			action: "removeRows",
			revision: legacy.revision,
			rowIds: [legacy.rows[0].id],
		})
		expect(next.rows.map((row) => row.sheetRowNumber)).toEqual([3, 4])
	})
	it("does not promote the seed or create empty rows when a structural save fails", async () => {
		const f = setup()
		await f.service.setEnabled("task", true)
		const selected = await f.service.command("task", { action: "select", listingId: listing.id })
		const before = await f.snapshot()
		f.store.save = async () => {
			throw new Error("disk full")
		}
		await expect(
			f.service.command("task", {
				action: "addRows",
				revision: selected.revision,
				count: 3,
			}),
		).rejects.toThrow("disk full")
		const after = await f.snapshot()
		expect(after.rows).toEqual(before.rows)
		expect(after.revision).toBe(before.revision)
		expect(effectiveTaskCount(after.rows)).toBe(0)
	})
	it("appends toolbar rows after a sparse task instead of silently billing an untouched seed", async () => {
		const f = setup()
		await f.service.setEnabled("task", true)
		const selected = await f.service.command("task", { action: "select", listingId: listing.id })
		const reservation = await f.service.reserveWorksheetAttachmentRow("task", selected.revision, 20, "text", () => true)
		await f.service.attach(
			"task",
			selected.revision,
			reservation.rowId,
			{
				id: "file",
				name: "note.txt",
				path: "D:/note.txt",
				field: "text",
				mode: "text",
			},
			"来自文件的文本",
		)
		await reservation.release()
		const filled = await f.snapshot()
		expect(effectiveTaskCount(filled.rows)).toBe(1)
		const next = await f.service.command("task", { action: "addRows", revision: filled.revision, count: 1 })
		expect(next.rows.find((row) => row.sheetRowNumber === 2)?.origin).toBe("implicit")
		expect(next.rows.find((row) => row.sheetRowNumber === 21)?.origin).toBe("explicit")
		expect(effectiveTaskCount(next.rows)).toBe(2)
	})
	it("keeps editable rows in the chat snapshot without copying quote rows or result history", async () => {
		const fixture = setup()
		await fixture.prepared()
		const full = await fixture.snapshot()
		const chat = await fixture.service.chatSnapshot("task")
		expect(full.quote?.inputRows).toHaveLength(3)
		expect(chat?.rows).toHaveLength(3)
		expect(chat?.quote).not.toHaveProperty("inputRows")
		expect(chat).not.toHaveProperty("results")
		expect(chat).not.toHaveProperty("artifacts")
		// A conversation without a task must not wait for any Batch restore.
		expect(await fixture.service.chatSnapshot(undefined)).toBeUndefined()
	})
	it("starts the selected SkillBot with one editable row and expands without discarding input", async () => {
		const { service, snapshot } = setup()
		await service.setEnabled("task", true)
		let s = await service.command("task", { action: "select", listingId: listing.id })
		expect(s.phase).toBe("collecting")
		expect(s.rows).toHaveLength(1)
		const firstRowId = s.rows[0].id
		s = await service.command("task", {
			action: "patch",
			revision: s.revision,
			rows: [{ id: firstRowId, values: { text: "保留原文" } }],
		})
		s = await service.command("task", { action: "addRows", count: 2, revision: s.revision })
		expect(s.rows.map((row) => row.id)).toHaveLength(3)
		expect(s.rows[0]).toMatchObject({ id: firstRowId, values: { text: "保留原文" } })
		await expect(service.command("task", { action: "quantity", count: 2, revision: s.revision })).rejects.toThrow("明确删除")
		s = await service.command("task", { action: "quantity", count: 4, revision: s.revision })
		expect(s.rows).toHaveLength(4)
		expect(s.rows[0].values.text).toBe("保留原文")
		expect((await snapshot()).revision).toBe(s.revision)
	})
	it("deletes explicit row IDs, invalidates the quote and protects filled rows from Agent deletion", async () => {
		const { service, prepared } = setup()
		let s = await prepared()
		await expect(
			service.command("task", { action: "removeRows", revision: s.revision, rowIds: [s.rows[0].id] }, "agent"),
		).rejects.toThrow("只能由用户确认")
		s = await service.command("task", { action: "removeRows", revision: s.revision, rowIds: [s.rows[1].id] })
		expect(s.rows).toHaveLength(2)
		expect(s.quote?.valid).toBe(false)
		expect(s.phase).toBe("collecting")
		await expect(service.command("task", { action: "execute", revision: s.revision, quoteId: s.quote!.id })).rejects.toThrow(
			"预算已失效",
		)
		s = await service.command("task", { action: "removeRows", revision: s.revision, rowIds: s.rows.map((row) => row.id) })
		expect(s.rows).toHaveLength(0)
		expect(s.phase).toBe("collecting")
		await expect(service.command("task", { action: "review", revision: s.revision })).rejects.toThrow("至少一行")
		s = await service.command("task", { action: "addRows", revision: s.revision, count: 1 }, "agent")
		expect(s.rows).toHaveLength(1)
	})
	it("keeps the previous SkillBot for a new batch unless the user explicitly changes workflows", async () => {
		const first = setup()
		const quoted = await first.prepared()
		const completed: BatchSession = {
			...quoted,
			phase: "completed",
			attempt: { requestId: "prior-request", quote: quoted.quote!, runId: "prior-run" },
			progress: { status: "completed", total: 3, completed: 3, failed: 0 },
		}
		const { service } = setup([completed])
		const previousId = completed.rows[0].id
		let s = await service.command("task", { action: "newBatch", revision: completed.revision })
		expect(s.listing?.id).toBe(listing.id)
		expect(s.phase).toBe("collecting")
		expect(s.rows).toHaveLength(1)
		expect(s.rows[0].id).not.toBe(previousId)
		expect(s.pastRuns).toHaveLength(1)
		expect(s.pastRuns?.[0].runId).toBe("prior-run")
		s = await service.command("task", { action: "newBatch", revision: s.revision, keepListing: false })
		expect(s.listing).toBeUndefined()
		expect(s.phase).toBe("selecting")
		expect(s.rows).toHaveLength(0)
		const parsed = parseBatchCommand(
			JSON.stringify({
				taskId: "task",
				command: { action: "newBatch", revision: s.revision, keepListing: false },
			}),
		)
		expect(parsed.command).toMatchObject({ action: "newBatch", keepListing: false })
	})
	it("uses N public input rows and omits the model default", async () => {
		const { prepared } = setup()
		const s = await prepared()
		expect(s.quote?.inputRows).toHaveLength(3)
		expect(s.quote?.inputRows[0]).toEqual({ count: 3, text: "原文0" })
	})
	it("invalidates the quote for edits to ANY row; rejects old revisions", async () => {
		const { service, prepared, snapshot, executed } = setup()
		const s = await prepared()
		await service.command("task", {
			action: "patch",
			revision: s.revision,
			rows: [{ id: s.rows[0].id, values: { text: "改第一条" } }],
		})
		expect((await snapshot()).quote?.valid).toBe(false)
		await expect(service.command("task", { action: "execute", revision: s.revision, quoteId: s.quote!.id })).rejects.toThrow(
			"预算已失效",
		)
		await expect(service.command("task", { action: "patch", revision: s.revision, rows: [] })).rejects.toThrow("输入已被更新")
		expect(executed).toHaveLength(0)
	})
	it("return to revise requires a new review and quote", async () => {
		const { service, prepared, snapshot } = setup()
		const s = await prepared()
		await service.command("task", { action: "revise", revision: s.revision })
		const revised = await snapshot()
		expect(revised.quote?.valid).toBe(false)
		const updated = await service.command("task", { action: "quote", revision: revised.revision })
		expect(updated.quote?.id).not.toBe(s.quote!.id)
	})
	it("requires review before requesting a budget", async () => {
		const { service, prepared, snapshot } = setup()
		const s = await prepared()
		await service.command("task", { action: "patch", revision: s.revision, rows: [] })
		await expect(service.command("task", { action: "quote", revision: (await snapshot()).revision })).rejects.toThrow(
			"先检查",
		)
	})
	it("serializes double approval and persists the attempt BEFORE execute", async () => {
		const { service, prepared, executed } = setup()
		const s = await prepared()
		const command = { action: "execute" as const, revision: s.revision, quoteId: s.quote!.id }
		const result = await Promise.allSettled([service.command("task", command), service.command("task", command)])
		expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1)
		expect(executed).toHaveLength(1)
	})
	it("lost responses cannot mint another attempt, including after restart", async () => {
		const fixture = setup()
		const s = await fixture.prepared()
		let calls = 0
		fixture.api.execute = async () => {
			calls++
			throw new Error("response lost")
		}
		const command = { action: "execute" as const, revision: s.revision, quoteId: s.quote!.id }
		await fixture.service.command("task", command)
		expect((await fixture.snapshot()).phase).toBe("execution-unknown")
		await expect(fixture.service.command("task", command)).rejects.toThrow("已提交")
		const resumed = setup(fixture.persisted())
		await expect(resumed.service.command("task", command)).rejects.toThrow("已提交")
		expect(calls).toBe(1)
		expect(resumed.executed).toHaveLength(0)
	})
	it("rolls back a failed pre-send save and allows explicit retry with the same confirmation ID", async () => {
		const f = setup()
		const s = await f.prepared()
		const save = f.store.save
		const seen: BatchSession[] = []
		f.service.subscribe("task", (snapshot) => seen.push(snapshot))
		f.store.save = async () => {
			throw new Error("disk full")
		}
		const command = { action: "execute" as const, revision: s.revision, quoteId: s.quote!.id }
		await expect(f.service.command("task", command)).rejects.toThrow("disk full")
		expect(f.executed).toHaveLength(0)
		expect((await f.snapshot()).phase).toBe("quoted")
		expect((await f.snapshot()).attempt).toBeUndefined()
		expect((await f.snapshot()).quote?.id).toBe(s.quote!.id)
		expect(seen.at(-1)?.error).toContain("本次未提交")
		expect(seen.at(-1)?.error).toContain("尚未保存")
		expect(f.persisted()[0].phase).toBe("quoted")
		f.store.save = save
		await f.service.command("task", command)
		expect(f.executed).toHaveLength(1)
		expect(f.executed[0].requestId).toBe(s.quote!.id)
		expect((await f.snapshot()).error).toBeUndefined()
	})
	it("persists a safe rollback if only the submitting save fails", async () => {
		const f = setup()
		const s = await f.prepared()
		const save = f.store.save
		f.store.save = async (state) => {
			if (state.phase === "submitting") throw new Error("confirmation write failed")
			await save(state)
		}
		await expect(
			f.service.command("task", { action: "execute", revision: s.revision, quoteId: s.quote!.id }),
		).rejects.toThrow("本次未提交")
		expect(f.persisted()[0]).toMatchObject({ phase: "quoted", attempt: undefined })
		expect(f.persisted()[0].error).toContain("confirmation write failed")
		expect(f.executed).toHaveLength(0)
	})
	it("missing credentials send no paid request and restoring them still requires explicit confirmation", async () => {
		const f = setup()
		const s = await f.prepared()
		let key: string | undefined
		const requests: Record<string, unknown>[] = []
		const client = new LoomLoomClient(() => key, (async (_url: unknown, init?: RequestInit) => {
			requests.push(JSON.parse(String(init?.body)))
			return new Response(JSON.stringify({ runId: "restored-run" }))
		}) as typeof fetch)
		f.api.execute = client.execute.bind(client)
		const command = { action: "execute" as const, revision: s.revision, quoteId: s.quote!.id }
		await expect(f.service.command("task", command)).rejects.toThrow("请先登录胜算云")
		expect(requests).toHaveLength(0)
		expect((await f.snapshot()).phase).toBe("quoted")
		expect((await f.snapshot()).attempt).toBeUndefined()
		expect((await f.snapshot()).error).toContain("本次未提交")
		expect(f.persisted()[0].phase).toBe("quoted")
		const resumed = setup(f.persisted())
		resumed.api.execute = client.execute.bind(client)
		key = "restored-test-only-key"
		await resumed.service.ready
		expect(requests).toHaveLength(0)
		await resumed.service.command("task", command)
		expect(requests).toHaveLength(1)
		expect(requests[0].clientRequestId).toBe(s.quote!.id)
		expect((await resumed.snapshot()).attempt?.runId).toBe("restored-run")
	})
	it("does not treat an auth-looking transport error as proof that no request was sent", async () => {
		const f = setup()
		const s = await f.prepared()
		f.api.execute = async () => {
			throw new Error("请先登录胜算云或配置已有的胜算云 API Key。")
		}
		await f.service.command("task", { action: "execute", revision: s.revision, quoteId: s.quote!.id })
		expect((await f.snapshot()).phase).toBe("execution-unknown")
		expect((await f.snapshot()).attempt?.requestId).toBe(s.quote!.id)
	})
	it("never rolls back a successful request when saving its result fails", async () => {
		const f = setup()
		const s = await f.prepared()
		const save = f.store.save
		f.store.save = async (state) => {
			if (state.phase === "running") throw new Error("result write failed")
			await save(state)
		}
		const command = { action: "execute" as const, revision: s.revision, quoteId: s.quote!.id }
		await expect(f.service.command("task", command)).rejects.toThrow("result write failed")
		expect((await f.snapshot()).phase).toBe("running")
		expect((await f.snapshot()).attempt?.runId).toBe("run-1")
		await expect(f.service.command("task", command)).rejects.toThrow("已提交")
		expect(f.executed).toHaveLength(1)
	})
	it("uses the freshly quoted fee as its execution baseline when the version stays the same", async () => {
		const f = setup()
		const previous = await f.prepared()
		await f.service.command("task", { action: "revise", revision: previous.revision })
		f.api.detail = async () => ({
			...structuredClone(listing),
			fee: { amount: "0.20", currency: "CNY" },
			description: "新说明",
		})
		f.api.quote = async () => ({
			taskCount: 3,
			listingVersionId: "v1",
			estimatedBuyerPayable: { amount: "0.60", currency: "CNY" },
		})
		const quoted = await f.service.command("task", { action: "quote", revision: (await f.snapshot()).revision })
		expect(quoted.listing?.fee?.amount).toBe("0.20")
		expect(quoted.listing?.description).toBe("新说明")
		expect(quoted.rows).toEqual(previous.rows)
		expect(quoted.quote?.hash).toBe(previous.quote?.hash)
		expect(quoted.quote?.payable.amount).toBe("0.60")
		await f.service.command("task", { action: "execute", revision: quoted.revision, quoteId: quoted.quote!.id })
		expect(f.executed).toHaveLength(1)
	})
	it("rejects a fee change after quoting, then accepts a newly confirmed quote", async () => {
		const f = setup()
		const oldQuote = await f.prepared()
		f.api.detail = async () => ({ ...structuredClone(listing), fee: { amount: "0.30", currency: "CNY" } })
		await expect(
			f.service.command("task", { action: "execute", revision: oldQuote.revision, quoteId: oldQuote.quote!.id }),
		).rejects.toThrow("价格已更新")
		expect(f.executed).toHaveLength(0)
		expect((await f.snapshot()).quote?.valid).toBe(false)
		f.api.quote = async () => ({ taskCount: 3, estimatedBuyerPayable: { amount: "0.90", currency: "CNY" } })
		const newQuote = await f.service.command("task", { action: "quote", revision: oldQuote.revision })
		expect(newQuote.quote?.id).not.toBe(oldQuote.quote!.id)
		await f.service.command("task", { action: "execute", revision: newQuote.revision, quoteId: newQuote.quote!.id })
		expect(f.executed).toHaveLength(1)
	})
	it("mode changes retain the draft and running state", async () => {
		const f = setup()
		const s = await f.prepared()
		await f.service.command("task", { action: "execute", revision: s.revision, quoteId: s.quote!.id })
		await f.service.setEnabled("task", false)
		const resumed = setup(f.persisted())
		const state = await resumed.snapshot()
		expect(state.rows).toHaveLength(3)
		expect(state.attempt?.runId).toBe("run-1")
		await resumed.service.setEnabled("task", true)
		expect((await resumed.snapshot()).attempt?.runId).toBe("run-1")
	})
	it("uses run status rather than completed rows from a page; preserves row errors", async () => {
		const f = setup()
		const s = await f.prepared()
		await f.service.command("task", { action: "execute", revision: s.revision, quoteId: s.quote!.id })
		await f.service.command("task", { action: "refreshRun" })
		expect((await f.snapshot()).phase).toBe("running")
		f.api.run = async () => ({
			status: "partially_failed",
			total: 3,
			completed: 2,
			failed: 1,
			rows: [{ rowIndex: 1, status: "failed", errorMessage: "model unavailable" }],
			artifacts: [],
		})
		await f.service.command("task", { action: "refreshRun" })
		expect((await f.snapshot()).phase).toBe("partial-failure")
		expect((await f.snapshot()).results[0].errorMessage).toBe("model unavailable")
	})
	it("fails closed on missing currency, stale version and unapproved fields", async () => {
		const f = setup()
		await f.prepared()
		let s = await f.snapshot()
		await expect(
			f.service.command("task", {
				action: "patch",
				revision: s.revision,
				rows: [{ id: s.rows[0].id, values: { secretPrompt: "inject" } }],
			}),
		).rejects.toThrow("未知输入字段")
		await f.service.command("task", { action: "revise", revision: s.revision })
		s = await f.snapshot()
		f.api.quote = async () => ({ taskCount: 3, estimatedBuyerPayable: { amount: "1" } })
		s = await f.service.command("task", { action: "quote", revision: s.revision })
		expect(s.phase).toBe("reviewing")
		expect(s.quote?.valid).toBe(false)
	})
	it("preserves filenames and invalidates a quote on attachment changes", async () => {
		const f = setup()
		const s = await f.prepared()
		await f.service.attach("task", s.revision, s.rows[1].id, { id: "file", name: "素材.md", path: "/workspace/素材.md" })
		const edited = await f.snapshot()
		expect(edited.rows[1].attachments[0].name).toBe("素材.md")
		expect(edited.quote?.valid).toBe(false)
	})
	it("accepts a single character and rejects unsupported schema versions", () => {
		expect(canonicalRows({ listing, rows: [{ id: "row", values: { text: "门" }, attachments: [] }] })).toEqual([
			{ text: "门" },
		])
		expect(() => parseBatchSchema({ schema_version: "future", fields: [] })).toThrow("暂不支持")
	})
})
