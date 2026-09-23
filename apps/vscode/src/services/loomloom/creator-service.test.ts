import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { LoomLoomClient } from "./client"
import { CreatorService, parseCreatorCommand } from "./creator-service"

const temporary: string[] = []
afterEach(async () => {
	for (const directory of temporary.splice(0)) await rm(directory, { recursive: true, force: true })
})

async function harness(respond: (route: string, body: Record<string, unknown> | undefined) => unknown) {
	const directory = await mkdtemp(path.join(tmpdir(), "loomloom-creator-"))
	temporary.push(directory)
	const calls: { route: string; body?: Record<string, unknown>; authorization: string | null }[] = []
	const transport = (async (url: string | URL | Request, init?: RequestInit) => {
		const route = new URL(String(url)).pathname.replace("/loom/v1", "")
		const body = init?.body ? JSON.parse(String(init.body)) : undefined
		calls.push({ route, body, authorization: new Headers(init?.headers).get("Authorization") })
		return new Response(JSON.stringify(respond(route, body)), { headers: { "Content-Type": "application/json" } })
	}) as typeof fetch
	const client = new LoomLoomClient(() => "test-credential", transport)
	return { service: new CreatorService(client, directory), calls, directory }
}

describe("creator API bridge", () => {
	it("lets the Agent change only design fields and rejects stale edits from either view", async () => {
		const { service, calls } = await harness(() => ({ unexpected: true }))
		const started = await service.patchDesign("new-task", null, { name: "Cline 新草稿" })
		expect(started.draft).toMatchObject({ version: 1, mode: "simple", name: "Cline 新草稿", advancedJson: "" })
		const original = await service.execute(
			{ action: "saveDraft", draft: { name: "旧名称", feeAmount: "2", validatedSpecJson: "old", templateId: "private-1" } },
			"task-one",
		)
		const events: Array<{ draft: Record<string, unknown>; updatedAt: number }> = []
		const unsubscribe = service.subscribeDraft("task-one", (event) => events.push(event))
		const changed = await service.patchDesign("task-one", original.updatedAt as number, { name: "新名称" })
		expect(changed.draft).toMatchObject({
			name: "新名称",
			feeAmount: "2",
			templateId: "private-1",
			validatedSpecJson: "",
		})
		expect(events).toHaveLength(1)
		await expect(service.patchDesign("task-one", original.updatedAt as number, { name: "过期修改" })).rejects.toThrow(
			"已更新",
		)
		await expect(
			service.execute(
				{ action: "saveDraft", draft: { name: "过期本地" }, expectedUpdatedAt: original.updatedAt as number },
				"task-one",
			),
		).rejects.toThrow("已被另一侧更新")
		expect(calls).toHaveLength(0)
		unsubscribe()
	})
	it("restores task-scoped local drafts after a new service instance and never sends them to LoomLoom", async () => {
		const { service, calls, directory } = await harness(() => ({ unexpected: true }))
		const draft = {
			name: "Private workflow",
			canonicalSpecV2: { meta: { name: "Private workflow" } },
			templateId: "template-1",
		}
		const saved = await service.execute({ action: "saveDraft", draft }, "task-one")
		expect(saved).toMatchObject({ draft, updatedAt: expect.any(Number) })
		const newer = { ...draft, name: "Revised workflow" }
		const latest = await service.execute({ action: "saveDraft", draft: newer }, "task-one")
		const reopened = new CreatorService(new LoomLoomClient(() => undefined), directory)
		expect(await reopened.execute({ action: "loadDraft" }, "task-one")).toEqual(latest)
		expect(await reopened.execute({ action: "loadDraft" }, "task-two")).toEqual({ draft: null, updatedAt: null })
		await expect(service.execute({ action: "saveDraft", draft: { apiKey: "sensitive" } }, "task-one")).rejects.toThrow(
			"不能包含凭据",
		)
		expect(calls).toHaveLength(0)
	})
	it("requires explicit confirmation on remote writes and keeps TemplateSpec v2 intact", async () => {
		const canonicalSpecV2 = { meta: { name: "Example" }, steps: [{ stepId: "compose", custom: { nested: true } }] }
		const { service, calls } = await harness((route) =>
			route === "/templateSpecs:validate" ? { valid: true, definitionHash: "hash" } : { versionId: "version-1" },
		)
		expect(() =>
			parseCreatorCommand(
				JSON.stringify({
					taskId: "task-1",
					command: {
						action: "saveVersion",
						templateId: "template-1",
						specVersion: "template-spec/v2",
						canonicalSpecV2,
					},
				}),
			),
		).toThrow()
		const parsed = parseCreatorCommand(
			JSON.stringify({
				taskId: "task-1",
				command: {
					action: "saveVersion",
					templateId: "template-1",
					specVersion: "template-spec/v2",
					canonicalSpecV2,
					confirm: true,
				},
			}),
		)
		await service.execute(parsed.command)
		expect(calls.map((call) => call.route)).toEqual(["/templateSpecs:validate", "/users/me/templates/template-1/versions"])
		expect(calls[1].body).toEqual({ specVersion: "template-spec/v2", canonicalSpecV2, versionNote: "" })
		expect(calls[0].authorization).toBe("Bearer test-credential")
	})

	it("publishes exact normal-unit fee and returns the server review request ID", async () => {
		const { service, calls } = await harness(() => ({
			reviewRequestId: "review-1",
			reviewStatus: "pending",
			id: "listing-1",
		}))
		const parsed = parseCreatorCommand(
			JSON.stringify({
				taskId: "task-1",
				command: {
					action: "publish",
					templateId: "template-1",
					versionId: "version-1",
					displayName: "Sample",
					description: "",
					taskFixedFee: { amount: "0.5", currency: "CNY" },
					confirm: true,
				},
			}),
		)
		expect(await service.execute(parsed.command)).toMatchObject({ reviewRequestId: "review-1" })
		expect(calls[0].route).toBe("/marketListings")
		expect(calls[0].body).toEqual({
			templateId: "template-1",
			templateVersionId: "version-1",
			displayName: "Sample",
			description: "",
			taskFixedFee: { amount: "0.5", currency: "CNY" },
		})
	})

	it("binds a paid private test run to the exact precheck and persists a one-shot guard", async () => {
		const { service, calls, directory } = await harness((route) =>
			route.endsWith(":precheck")
				? { estimatedTotalCostT: 5000000, pricingRevision: "p-1", estimatedTotalCost: { amount: "0.5", currency: "CNY" } }
				: { runId: "run-1", status: "queued" },
		)
		await service.execute({
			action: "precheckPrivate",
			templateId: "template-1",
			versionId: "version-1",
			inputFileId: "input-1",
		})
		const command = {
			action: "runPrivate" as const,
			templateId: "template-1",
			versionId: "version-1",
			inputFileId: "input-1",
			expectedEstimatedCostT: 5000000,
			expectedPricingRevision: "p-1",
			confirm: true as const,
		}
		expect(await service.execute(command)).toMatchObject({ runId: "run-1" })
		await expect(service.execute(command)).rejects.toThrow("已提交")
		expect(calls.filter((call) => call.route.endsWith(":run"))).toHaveLength(1)
		expect(calls.find((call) => call.route.endsWith(":run"))?.body).toMatchObject({
			versionId: "version-1",
			inputFileId: "input-1",
			expectedEstimatedCostT: 5000000,
			expectedPricingRevision: "p-1",
		})
		const persisted = JSON.parse(await readFile(path.join(directory, "private-run-attempts.json"), "utf8"))
		expect(persisted[0]).toMatchObject({ runId: "run-1" })
	})

	it("checks run identity against the selected immutable version", async () => {
		const { service } = await harness((route) =>
			route.endsWith("/versions")
				? { items: [{ versionId: "version-1", definitionHash: "hash-1" }] }
				: {
						run: {
							runId: "run-1",
							templateUuid: "template-1",
							definitionHash: "hash-1",
							status: "completed",
							completedTasks: 1,
							totalTasks: 1,
						},
					},
		)
		expect(
			await service.execute({
				action: "privateRunStatus",
				runId: "run-1",
				templateId: "template-1",
				versionId: "version-1",
			}),
		).toMatchObject({
			run: { status: "completed", completedTasks: 1 },
		})
		await expect(
			service.execute({ action: "privateRunStatus", runId: "run-1", templateId: "another", versionId: "version-1" }),
		).rejects.toThrow("不匹配")
	})
})
