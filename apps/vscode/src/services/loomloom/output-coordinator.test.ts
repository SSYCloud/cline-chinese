import { afterEach, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import path from "node:path"
import type { BatchArtifact, BatchSession } from "@shared/loomloom"
import { BatchService, type BatchStore } from "./batch-service"
import type { BatchApi } from "./client"
import { BatchOutputCoordinator, type BatchOutputWriter, MAX_LOCAL_OUTPUT_FILES_PER_RUN } from "./output-coordinator"
import { MAX_INLINE_ARTIFACT_BYTES } from "./output-file-adapter"

const originalRoot = path.resolve("original-task-workspace")
const otherRoot = path.resolve("other-task-workspace")
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
})
function state(): BatchSession {
	const quote = {
		id: "quote",
		revision: 4,
		hash: createHash("sha256")
			.update(JSON.stringify([{ text: "input" }]))
			.digest("hex"),
		versionId: "v1",
		inputRows: [{ text: "input" }],
		payable: { amount: "1", currency: "CNY" },
		taskCount: 1,
		at: Date.now(),
		valid: true,
	}
	return {
		version: 1,
		taskId: "task",
		id: "batch",
		enabled: true,
		revision: 4,
		phase: "completed",
		listing: {
			id: "listing",
			name: "Test",
			description: "",
			versionId: "v1",
			availability: "available",
			schema: {
				schema_version: "loom_market_public_input_schema_v1",
				fields: [{ key: "text", value_type: "string", required: true }],
			},
		},
		rows: [{ id: "row", values: { text: "input" }, attachments: [] }],
		quote,
		attempt: { requestId: "quote", runId: "run", quote, outputDestination: { baseDirectory: originalRoot } },
		outputDestination: { baseDirectory: originalRoot },
		results: [
			{
				rowIndex: 0,
				status: "completed",
				artifacts: [{ artifactId: "text", inlineText: "hello", mimeType: "text/plain" }],
			},
		],
		artifacts: [],
		events: [],
	}
}
function setup(initial = state(), providedWriter?: BatchOutputWriter) {
	let persisted = structuredClone(initial)
	let saves = 0,
		executes = 0,
		reads = 0
	const store: BatchStore = {
		loadAll: async () => [structuredClone(persisted)],
		save: async (session) => {
			saves++
			persisted = structuredClone(session)
		},
	}
	const api: BatchApi = {
		detail: async () => initial.listing!,
		quote: async () => ({}),
		execute: async () => {
			executes++
			return { runId: "new-run" }
		},
		run: async () => {
			reads++
			return {
				status: "completed",
				total: 1,
				completed: 1,
				failed: 0,
				rows: structuredClone(initial.results),
				artifacts: [],
			}
		},
	}
	const service = new BatchService(store, api, () => {}, 60_000)
	const writes: Parameters<BatchOutputWriter>[0][] = []
	const savedResult = (args: Parameters<BatchOutputWriter>[0]) => ({
		path: path.join(args.baseDirectory, `${args.runId}-${args.rowIndex}-${args.artifactIndex}.txt`),
		relativePath: `${args.runId}-${args.rowIndex}-${args.artifactIndex}.txt`,
		sha256: createHash("sha256").update(args.artifact.inlineText!).digest("hex"),
		sizeBytes: Buffer.byteLength(args.artifact.inlineText!),
		extension: ".txt",
		mimeType: "text/plain",
	})
	const writer: BatchOutputWriter = async (args) => {
		writes.push(structuredClone(args))
		return providedWriter ? providedWriter(args) : savedResult(args)
	}
	const coordinator = new BatchOutputCoordinator(service, writer)
	cleanups.push(() => {
		coordinator.dispose()
		service.dispose()
	})
	return {
		service,
		coordinator,
		store,
		api,
		writes,
		savedResult,
		persisted: () => persisted,
		counts: () => ({ saves, executes, reads }),
	}
}

describe("task-scoped local output coordination", () => {
	it("does not export on construction, view changes, or mode notifications", async () => {
		const f = setup()
		await f.service.ready
		f.service.notifyActiveTaskChanged("task", "other")
		await f.service.updateWorksheet("task", { sheet: "current", range: "C2" })
		await f.service.setEnabled("task", false)
		await f.coordinator.whenIdle()
		expect(f.writes).toHaveLength(0)
		expect(f.counts().reads).toBe(0)
	})
	it("refresh persists remote success before exporting; repeated polls preserve one trusted local record", async () => {
		const f = setup()
		const before = await f.service.snapshot("task")
		await f.service.command("task", { action: "refreshRun" })
		await f.coordinator.whenIdle()
		await f.service.command("task", { action: "refreshRun" })
		await f.coordinator.whenIdle()
		expect(f.writes).toHaveLength(1)
		const saved = f.persisted()
		expect(saved.localOutputs).toHaveLength(1)
		expect(saved.localOutputs![0]).toMatchObject({ status: "saved", runId: "run", rowIndex: 0, artifactIndex: 0 })
		expect(saved.phase).toBe("completed")
		expect(saved.revision).toBe(before!.revision)
		expect(saved.quote).toEqual(before!.quote)
		expect(f.counts().executes).toBe(0)
		const restored = setup(saved)
		await restored.coordinator.ensure("task", "run")
		expect(restored.writes).toHaveLength(0)
	})
	it("freezes the original task directory at execution and never borrows the active task directory", async () => {
		const initial = state()
		initial.attempt = undefined
		initial.outputDestination = undefined
		initial.phase = "quoted"
		const f = setup(initial)
		await f.service.configureOutputDestination("task", originalRoot)
		await f.service.command("task", { action: "execute", revision: initial.revision, quoteId: initial.quote!.id })
		await f.service.configureOutputDestination("task", otherRoot)
		f.service.notifyActiveTaskChanged("task", "other-task")
		await f.service.command("task", { action: "refreshRun" })
		await f.coordinator.whenIdle()
		expect(f.writes[0].baseDirectory).toBe(originalRoot)
		expect(f.persisted().attempt?.outputDestination?.baseDirectory).toBe(originalRoot)
		expect(f.counts().executes).toBe(1)
	})
	it("archives the frozen destination and saves only explicitly refreshed history", async () => {
		const f = setup()
		await f.service.command("task", { action: "newBatch" })
		expect(f.persisted().pastRuns?.[0].outputDestination?.baseDirectory).toBe(originalRoot)
		await f.coordinator.whenIdle()
		expect(f.writes).toHaveLength(0)
		await f.service.configureOutputDestination("task", otherRoot)
		await f.service.refreshHistory("task", "run")
		await f.coordinator.whenIdle()
		expect(f.writes[0].baseDirectory).toBe(originalRoot)
		expect(f.persisted().localOutputs?.[0].runId).toBe("run")
		expect(f.persisted().attempt).toBeUndefined()
		// A new batch keeps its SkillBot by default, while the archived run stays immutable.
		expect(f.persisted().phase).toBe("collecting")
	})
	it("reports a missing original destination without using a later configured root", async () => {
		const initial = state()
		initial.attempt!.outputDestination = undefined
		initial.outputDestination = undefined
		const f = setup(initial)
		await f.service.configureOutputDestination("task", otherRoot)
		await f.coordinator.ensure("task", "run")
		expect(f.writes).toHaveLength(0)
		expect(f.persisted().localOutputs![0]).toMatchObject({ status: "error" })
		expect(f.persisted().localOutputs![0].error).toContain("原任务未绑定输出目录")
		expect(f.persisted().phase).toBe("completed")
	})
	it("ignores empty and binary artifacts before requiring an output destination", async () => {
		const initial = state()
		initial.attempt!.outputDestination = undefined
		initial.outputDestination = undefined
		initial.results[0].artifacts = [
			{ inlineText: "", mimeType: "image/png", accessUrl: "https://example.invalid/image" },
			{ inlineText: " \n\t", mimeType: "text/plain" },
			{ inlineText: "binary payload", mimeType: "application/pdf", accessUrl: "https://example.invalid/document" },
		]
		const f = setup(initial)
		await f.coordinator.ensure("task", "run")
		expect(f.writes).toHaveLength(0)
		expect(f.persisted().localOutputs).toBeUndefined()
		expect(f.counts().saves).toBe(0)
	})
	it("local failure keeps cloud success and permits a local retry without executing or re-quoting", async () => {
		let fail = true
		const f = setup(state(), async (args) => {
			if (fail) throw new Error("disk full")
			return f.savedResult(args)
		})
		await f.coordinator.ensure("task", "run")
		expect(f.persisted().localOutputs![0].error).toBe("disk full")
		expect(f.persisted().phase).toBe("completed")
		expect(f.persisted().error).toBeUndefined()
		fail = false
		await f.coordinator.ensure("task", "run")
		expect(f.persisted().localOutputs).toHaveLength(1)
		expect(f.persisted().localOutputs![0].status).toBe("saved")
		expect(f.counts().executes).toBe(0)
		expect(f.persisted().quote?.valid).toBe(true)
	})
	it("explicit force rechecks saved artifacts through the writer without background recreation", async () => {
		const f = setup()
		await f.coordinator.ensure("task", "run")
		await f.coordinator.ensure("task", "run")
		expect(f.writes).toHaveLength(1)
		await f.coordinator.ensure("task", "run", true)
		expect(f.writes).toHaveLength(2)
		expect(f.persisted().localOutputs).toHaveLength(1)
		expect(f.counts().executes).toBe(0)
	})
	it("explicit export may bind an unbound legacy run to its host-resolved original root", async () => {
		const initial = state()
		initial.attempt!.outputDestination = undefined
		const f = setup(initial)
		await f.service.configureOutputDestination("task", originalRoot, "run")
		await f.service.configureOutputDestination("task", otherRoot, "run")
		await f.coordinator.ensure("task", "run", true)
		expect(f.writes[0].baseDirectory).toBe(originalRoot)
		await expect(f.service.configureOutputDestination("task", otherRoot, "foreign")).rejects.toThrow("不属于")
	})
	it("coalesces concurrent refreshes, observes changed content, and finishes a run archived during saving", async () => {
		let release!: () => void
		const blocked = new Promise<void>((resolve) => {
			release = resolve
		})
		let started!: () => void
		const writing = new Promise<void>((resolve) => {
			started = resolve
		})
		let first = true
		const f = setup(state(), async (args) => {
			if (first) {
				first = false
				started()
				await blocked
			}
			return f.savedResult(args)
		})
		const saving = f.coordinator.ensure("task", "run")
		await writing
		await f.service.command("task", { action: "newBatch" })
		f.api.run = async () => ({
			status: "completed",
			total: 1,
			completed: 1,
			failed: 0,
			artifacts: [],
			rows: [{ rowIndex: 0, status: "completed", artifacts: [{ inlineText: "updated" }] }],
		})
		await f.service.refreshHistory("task", "run")
		const duplicate = f.coordinator.ensure("task", "run")
		expect(f.writes).toHaveLength(1)
		release()
		await Promise.all([saving, duplicate])
		expect(f.writes).toHaveLength(2)
		expect(f.writes[1].artifact.inlineText).toBe("updated")
		expect(f.writes.every((write) => write.baseDirectory === originalRoot)).toBe(true)
		expect(f.persisted().localOutputs).toHaveLength(1)
		expect(f.persisted().localOutputs![0].sha256).toBe(createHash("sha256").update("updated").digest("hex"))
	})
	it("ignores URL-only artifacts and any cloud-injected local paths", async () => {
		const initial = state()
		initial.results[0].artifacts = [
			{ accessUrl: "https://example.invalid/result", path: otherRoot, localPath: otherRoot } as BatchArtifact,
			{ inlineText: "hello", path: otherRoot } as BatchArtifact,
		]
		const f = setup(initial)
		await f.coordinator.ensure("task", "run")
		expect(f.writes).toHaveLength(1)
		expect(f.writes[0].baseDirectory).toBe(originalRoot)
		expect(f.persisted().localOutputs![0].path).toStartWith(originalRoot)
		expect(f.counts().reads).toBe(0)
	})
	it("rejects cross-task/run local record injection", async () => {
		const f = setup()
		await expect(f.coordinator.ensure("task", "foreign-run")).rejects.toThrow("不属于")
		await expect(f.service.recordLocalOutputs("task", "foreign-run", [])).rejects.toThrow("不属于")
		await expect(
			f.service.recordLocalOutputs("task", "run", [
				{ runId: "foreign-run", rowIndex: 0, artifactIndex: 0, contentHash: "hash", status: "error" },
			]),
		).rejects.toThrow("运行或位置无效")
		expect(f.writes).toHaveLength(0)
	})
	it("caps file count and individual bytes while recording local-only errors", async () => {
		const initial = state()
		initial.results[0].artifacts = Array.from({ length: MAX_LOCAL_OUTPUT_FILES_PER_RUN + 3 }, () => ({ inlineText: "small" }))
		const f = setup(initial)
		await f.coordinator.ensure("task", "run")
		expect(f.writes).toHaveLength(MAX_LOCAL_OUTPUT_FILES_PER_RUN)
		expect(f.persisted().localOutputs!.at(-1)!.error).toContain("数量上限")
		const oversized = state()
		oversized.results[0].artifacts = [{ inlineText: "x".repeat(MAX_INLINE_ARTIFACT_BYTES + 1) }]
		const large = setup(oversized)
		await large.coordinator.ensure("task", "run")
		expect(large.writes).toHaveLength(0)
		expect(large.persisted().localOutputs![0].error).toContain("大小上限")
	})
	it("does not advertise saved metadata when its persistence fails, and can retry", async () => {
		const f = setup()
		const save = f.store.save
		f.store.save = async () => {
			throw new Error("record store unavailable")
		}
		await expect(f.coordinator.ensure("task", "run")).rejects.toThrow("record store unavailable")
		expect((await f.service.snapshot("task"))!.localOutputs).toBeUndefined()
		f.store.save = save
		await f.coordinator.ensure("task", "run")
		expect(f.persisted().localOutputs![0].status).toBe("saved")
	})
	it("dispose prevents future automatic or explicit saves", async () => {
		const f = setup()
		f.coordinator.dispose()
		await f.service.command("task", { action: "refreshRun" })
		await f.coordinator.ensure("task", "run")
		await f.coordinator.whenIdle()
		expect(f.writes).toHaveLength(0)
	})
})
