import { afterEach, expect, it } from "bun:test"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { BatchSession, SkillBot } from "@shared/loomloom"
import { toBatchChatSnapshot } from "@shared/loomloom"
import { BatchService } from "./batch-service"
import type { BatchApi } from "./client"
import { BatchOutputCoordinator } from "./output-coordinator"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
	for (const cleanup of cleanups.splice(0)) await cleanup()
})
it("turns delivered plain HTML into a persisted local file without replacing user edits or starting another run", async () => {
	const parent = await realpath(process.cwd()),
		base = await mkdtemp(path.join(parent, ".batch-output-flow-"))
	const listing: SkillBot = {
		id: "listing",
		versionId: "v1",
		name: "页面生成",
		description: "",
		availability: "available",
		schema: {
			schema_version: "loom_market_public_input_schema_v1",
			fields: [{ key: "source", label: "源文本", value_type: "string", required: true }],
		},
	}
	const html = '<!doctype html>\n<html lang="zh"><head><title>结果</title></head><body><h1>页面产物</h1></body></html>'
	let executions = 0,
		persisted: BatchSession | undefined
	const api: BatchApi = {
		detail: async () => listing,
		quote: async () => ({ taskCount: 1, estimatedBuyerPayable: { amount: "0.1", currency: "CNY" } }),
		execute: async () => {
			executions++
			return { runId: "fake-local-test-run" }
		},
		run: async () => ({
			status: "completed",
			total: 1,
			completed: 1,
			failed: 0,
			rows: [
				{
					rowIndex: 0,
					status: "completed",
					artifacts: [{ artifactId: "html", mimeType: "text/plain", portName: "网页", inlineText: html }],
				},
			],
			artifacts: [],
		}),
	}
	const batch = new BatchService(
		{
			loadAll: async () => [],
			save: async (s) => {
				persisted = structuredClone(s)
			},
		},
		api,
		() => {},
		60_000,
	)
	const outputs = new BatchOutputCoordinator(batch)
	cleanups.push(async () => {
		outputs.dispose()
		batch.dispose()
		const resolved = path.resolve(base)
		if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith(".batch-output-flow-"))
			throw new Error("Unsafe fixture cleanup")
		await rm(resolved, { recursive: true, force: true })
	})
	await batch.setEnabled("original-task", true)
	await batch.configureOutputDestination("original-task", base)
	await batch.command("original-task", { action: "select", listingId: "listing" })
	let s = (await batch.snapshot("original-task"))!
	await batch.command("original-task", { action: "quantity", revision: s.revision, count: 1 })
	await outputs.whenIdle()
	expect(persisted?.localOutputs).toBeUndefined()
	s = (await batch.snapshot("original-task"))!
	await batch.command("original-task", {
		action: "patch",
		revision: s.revision,
		rows: [{ id: s.rows[0].id, values: { source: "生成网页" } }],
	})
	s = (await batch.snapshot("original-task"))!
	await batch.command("original-task", { action: "review", revision: s.revision })
	s = await batch.command("original-task", { action: "quote", revision: s.revision })
	await batch.command("original-task", { action: "execute", revision: s.revision, quoteId: s.quote!.id })
	await batch.command("original-task", { action: "refreshRun" })
	await outputs.whenIdle()
	s = (await batch.snapshot("original-task"))!
	const saved = s.localOutputs![0]
	expect(s.phase).toBe("completed")
	expect(saved.status).toBe("saved")
	expect(saved.path).toEndWith(".html")
	expect(await readFile(saved.path!, "utf8")).toBe(html)
	expect(toBatchChatSnapshot(s)?.outputSummary?.saved).toBe(1)
	expect(persisted?.localOutputs?.[0].path).toBe(saved.path)
	await writeFile(saved.path!, "用户继续修改过的网页", "utf8")
	await batch.command("original-task", { action: "refreshRun" })
	await outputs.whenIdle()
	expect(await readFile(saved.path!, "utf8")).toBe("用户继续修改过的网页")
	await outputs.ensure("original-task", "fake-local-test-run", true)
	const regenerated = (await batch.snapshot("original-task"))!.localOutputs![0]
	expect(regenerated.path).not.toBe(saved.path)
	expect(await readFile(regenerated.path!, "utf8")).toBe(html)
	await batch.command("original-task", { action: "newBatch" })
	await batch.refreshHistory("original-task", "fake-local-test-run")
	await outputs.whenIdle()
	expect((await batch.snapshot("original-task"))!.localOutputs![0].path).toBe(regenerated.path)
	expect(executions).toBe(1)
})
