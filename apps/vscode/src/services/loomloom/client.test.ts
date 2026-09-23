import { describe, expect, it } from "bun:test"
import { LoomLoomClient } from "./client"
import { LoomLoomRequestNotSubmittedError } from "./errors"

describe("LoomLoom transport", () => {
	it("marks missing local credentials as not submitted before invoking transport", async () => {
		let calls = 0
		const client = new LoomLoomClient(() => undefined, (async () => {
			calls++
			return new Response("{}")
		}) as unknown as typeof fetch)
		await expect(client.execute("listing", "v1", [], "confirmation")).rejects.toBeInstanceOf(LoomLoomRequestNotSubmittedError)
		expect(calls).toBe(0)
	})
	it("never classifies network errors or remote auth rejection as local not-submitted", async () => {
		for (const transport of [
			async () => {
				throw new Error("connection lost")
			},
			async () => new Response("{}", { status: 401 }),
		]) {
			const client = new LoomLoomClient(() => "test-only", transport as unknown as typeof fetch)
			let failure: unknown
			try {
				await client.execute("listing", "v1", [], "confirmation")
			} catch (error) {
				failure = error
			}
			expect(failure).toBeInstanceOf(Error)
			expect(failure).not.toBeInstanceOf(LoomLoomRequestNotSubmittedError)
		}
	})
	it("reads the models response, filters modality and invalid IDs, and deduplicates catalog entries", async () => {
		const requested: string[] = []
		const client = new LoomLoomClient(() => "test-only", (async (url: string | URL | Request) => {
			requested.push(String(url))
			return new Response(
				JSON.stringify({
					models: [
						{ modelId: "text-a", displayName: "文本 A", supportedStepTypes: ["text-generate"], authoringOptions: {} },
						{ modelId: "text-a", displayName: "重复", supportedStepTypes: ["text-generate"] },
						{ modelId: "image-a", displayName: "图片 A", supportedStepTypes: ["image-generate"] },
						{ modelId: "legacy" },
						{ modelId: "no-support", supportedStepTypes: [] },
						{ modelId: "bad-support", supportedStepTypes: "text-generate" },
						{ modelId: "" },
						{ modelId: " " },
						{ modelId: 123 },
						{ displayName: "缺少 ID" },
						null,
					],
				}),
			)
		}) as typeof fetch)
		expect(await client.models("text-generate")).toEqual([
			{ id: "text-a", name: "文本 A" },
			{ id: "legacy", name: "legacy" },
		])
		expect(requested[0]).toEndWith("/models?stepType=text-generate")
		expect(await client.models("image-generate")).toEqual([
			{ id: "image-a", name: "图片 A" },
			{ id: "legacy", name: "legacy" },
		])
		await expect(client.models("text")).rejects.toThrow("模型类型未声明")
		expect(requested).toHaveLength(2)
	})
	it("follows result pages while keeping the authoritative run status and row errors", async () => {
		const requested: string[] = []
		const client = new LoomLoomClient(() => "test-only", (async (url: string | URL | Request, init?: RequestInit) => {
			requested.push(String(url))
			expect(init?.redirect).toBe("error")
			const body = String(url).includes("resultRows")
				? String(url).includes("pageToken=second")
					? { items: [{ rowIndex: 50, status: "failed", errorMessage: "unavailable" }] }
					: { items: [{ rowIndex: 0, status: "completed" }], nextPageToken: "second", totalCount: 51 }
				: {
						run: { status: "running", totalTasks: 51, completedTasks: 1, failedTasks: 1 },
						market: { listingId: "listing" },
					}
			return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
		}) as typeof fetch)
		const run = await client.run("run")
		expect(requested).toHaveLength(3)
		expect(run.status).toBe("running")
		expect(run.rows[1]).toMatchObject({ rowIndex: 50, errorMessage: "unavailable" })
	})
	it("reads the existing credential anew on each request, without persisting it", async () => {
		let key = "first-test-key"
		const seen: unknown[] = []
		const client = new LoomLoomClient(() => key, (async (_url: unknown, init?: RequestInit) => {
			seen.push(new Headers(init?.headers).get("Authorization"))
			return new Response(JSON.stringify({ items: [] }))
		}) as typeof fetch)
		await client.catalog()
		key = "replacement-test-key"
		await client.catalog()
		expect(seen).toEqual(["Bearer first-test-key", "Bearer replacement-test-key"])
	})
	it("rebuilds public result fields and strips cloud-supplied local metadata", async () => {
		const artifact = {
			artifactId: "artifact",
			inlineText: "text",
			mimeType: "text/plain",
			accessUrl: "https://example.invalid/result",
			portName: "document",
			sourceRowIndex: 91,
			path: "C:/injected.txt",
			localPath: "C:/injected.txt",
			status: "saved",
			contentHash: "forged",
			localOutput: { path: "C:/injected.txt" },
		}
		const client = new LoomLoomClient(
			() => "test-only",
			(async (url: string | URL | Request) =>
				new Response(
					JSON.stringify(
						String(url).includes("resultRows")
							? {
									items: [
										{
											rowIndex: 0,
											status: "completed",
											path: "C:/injected.txt",
											localOutputs: [artifact],
											artifacts: [artifact, null, "invalid"],
											stepErrors: [{ stepId: "step", errorMessage: "message", path: "C:/injected.txt" }],
										},
									],
								}
							: { run: { status: "completed" } },
					),
				)) as typeof fetch,
		)
		const result = await client.run("run")
		expect(result.rows[0]).not.toHaveProperty("path")
		expect(result.rows[0]).not.toHaveProperty("localOutputs")
		expect(result.rows[0].stepErrors).toEqual([{ stepId: "step", errorMessage: "message" }])
		expect(result.artifacts).toEqual([
			{
				artifactId: "artifact",
				inlineText: "text",
				mimeType: "text/plain",
				accessUrl: "https://example.invalid/result",
				portName: "document",
				sourceRowIndex: 0,
			},
		])
		expect(result.rows[0].artifacts).toEqual(result.artifacts)
	})
	it("rejects malformed result positions instead of treating them as local output coordinates", async () => {
		for (const rowIndex of [-1, 1.5, "0"]) {
			const client = new LoomLoomClient(
				() => "test-only",
				(async (url: string | URL | Request) =>
					new Response(
						JSON.stringify(
							String(url).includes("resultRows")
								? { items: [{ rowIndex, status: "completed" }] }
								: { run: { status: "completed" } },
						),
					)) as typeof fetch,
			)
			await expect(client.run("run")).rejects.toThrow("位置或状态无效")
		}
	})
})
