import { mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ClineCore, createAgentRuntime } from "@cline/core"
import type { AgentBeforeModelContext, AgentModel, AgentModelEvent, AgentModelRequest, AgentToolContext } from "@cline/shared"
import type { SkillBot } from "@shared/loomloom"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BatchAgentBridge } from "./batch-agent-bridge"
import { BatchPresentationCoordinator } from "./batch-presentation"
import { BatchService } from "./batch-service"
import type { BatchApi } from "./client"
import type { CreatorService } from "./creator-service"
import { SkillBotDirectory } from "./skillbot-directory"
import { BatchTableService } from "./table-operations"

const services: BatchService[] = []
const presentations: BatchPresentationCoordinator[] = []
afterEach(() => {
	for (const presentation of presentations) presentation.dispose()
	presentations.length = 0
	for (const service of services) service.dispose()
	services.length = 0
})
const listing: SkillBot = {
	id: "real-directory-id",
	name: "目录里的文本扩写助手",
	description: "从目录返回，而非硬编码推荐",
	versionId: "v1",
	availability: "available",
	fee: { amount: "0.1", currency: "CNY" },
	schema: {
		schema_version: "loom_market_public_input_schema_v1",
		fields: [{ key: "text", label: "原文", required: true, value_type: "string" }],
	},
}
function fixture() {
	const api: BatchApi & { catalog: () => Promise<{ items: SkillBot[]; nextPageToken: string }> } = {
		detail: async () => structuredClone(listing),
		catalog: async () => ({ items: [listing], nextPageToken: "" }),
		quote: async (_id, _version, rows) => ({
			taskCount: rows.length,
			listingVersionId: "v1",
			estimatedBuyerPayable: { amount: "0.3", currency: "CNY" },
		}),
		execute: async () => ({ runId: "same-conversation-run" }),
		run: async () => ({
			listingId: listing.id,
			status: "completed",
			total: 2,
			completed: 2,
			failed: 0,
			rows: [{ rowIndex: 0, status: "completed", artifacts: [{ inlineText: "云端真实返回值的测试替身" }] }],
			artifacts: [],
		}),
	}
	const service = new BatchService({ loadAll: async () => [], save: async () => {} }, api, () => {}, 60_000)
	services.push(service)
	const directory = new SkillBotDirectory(api, {
		list: async () => [{ id: listing.id, name: listing.name }],
		set: async () => {},
	})
	const native = {
		open: vi.fn(async () => {}),
		action: vi.fn(async () => {}),
		attach: vi.fn(async () => {}),
		models: vi.fn(async () => []),
	}
	const table = new BatchTableService(service, native, () => "same-session")
	const presentation = new BatchPresentationCoordinator(service, {
		currentTask: () => "same-session",
		open: native.open,
		onError: (error) => {
			throw error
		},
	})
	presentations.push(presentation)
	const bridge = new BatchAgentBridge(service, directory, () => "same-session", table)
	const snapshot = async () => (await service.snapshot("same-session"))!
	return { service, directory, bridge, snapshot, table, native, presentation }
}
function hostData(request: AgentModelRequest) {
	const content = request.messages
		.flatMap((m) => m.content)
		.filter((p) => p.type === "text")
		.map((p) => (p.type === "text" ? p.text : ""))
	const blocks = content.filter((t) => t.startsWith("<cline_batch_context>"))
	expect(blocks.length).toBeLessThanOrEqual(1)
	return blocks[0] ? JSON.parse(blocks[0].slice("<cline_batch_context>".length, -"\n</cline_batch_context>".length)) : undefined
}
function requestContext(request: AgentModelRequest): AgentBeforeModelContext {
	return {
		request,
		snapshot: {
			agentId: "cline",
			conversationId: "same-session",
			status: "running",
			iteration: 1,
			messages: [],
			pendingToolCalls: [],
			usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
		},
	}
}

describe("Batch participates in the existing Agent runtime", () => {
	it("lets the same Agent edit a local creator draft without creator billing or publishing tools", async () => {
		const f = fixture()
		await f.service.setEnabled("same-session", true)
		const creator = {
			execute: vi.fn(async () => ({ draft: { name: "旧名称" }, updatedAt: 10 })),
			patchDesign: vi.fn(async () => ({ draft: { name: "新名称" }, updatedAt: 11 })),
		} as unknown as CreatorService
		const bridge = new BatchAgentBridge(f.service, f.directory, () => "same-session", f.table, creator)
		const tool = bridge.tools().find((item) => item.name === "loomloom_creator_draft")!
		const context = { sessionId: "same-session", agentId: "cline", iteration: 1 } as AgentToolContext
		expect(await tool.execute({ action: "read" }, context)).toMatchObject({ updatedAt: 10 })
		expect(await tool.execute({ action: "update", expectedUpdatedAt: 10, patch: { name: "新名称" } }, context)).toMatchObject(
			{
				updatedAt: 11,
			},
		)
		expect(creator.patchDesign).toHaveBeenCalledWith("same-session", 10, { name: "新名称" })
		expect(
			await tool.execute({ action: "update", expectedUpdatedAt: 11, patch: { feeAmount: "999" } }, context),
		).toHaveProperty("error")
		expect(creator.patchDesign).toHaveBeenCalledTimes(1)
		await tool.execute({ action: "update", patch: { name: "首个草稿" } }, context)
		expect(creator.patchDesign).toHaveBeenCalledWith("same-session", null, { name: "首个草稿" })
		expect(bridge.tools().map((item) => item.name)).not.toContain("loomloom_creator_publish")
	})
	it("runs a worksheet command through the real SDK and synchronizes both directions in the SAME runtime", async () => {
		const f = fixture()
		await f.service.setEnabled("same-session", true)
		await f.service.command("same-session", { action: "select", listingId: listing.id })
		await f.service.command("same-session", { action: "quantity", revision: (await f.snapshot()).revision, count: 2 })
		await f.presentation.whenIdle()
		expect(f.native.open).toHaveBeenCalledWith("same-session", true)
		expect(f.native.open).toHaveBeenCalledTimes(1)
		const changed: string[] = []
		const unsubscribe = f.service.subscribe("same-session", (s) => changed.push(String(s.rows[1]?.values.text ?? "")))
		const captured: AgentModelRequest[] = []
		const runtime = createAgentRuntime({
			sessionId: "same-session",
			conversationId: "same-session",
			tools: f.bridge.tools(),
			hooks: f.bridge.withHooks(undefined),
			model: {
				async *stream(request) {
					captured.push(request)
					if (captured.length === 1) {
						yield {
							type: "tool-call-delta",
							toolCallId: "cell-write",
							toolName: "loomloom_table",
							input: {
								action: "write",
								range: "C2:C3",
								revision: hostData(request).revision,
								values: [["聊天整理第一条"], ["聊天整理第二条"]],
							},
						}
						yield { type: "finish", reason: "tool-calls" }
					} else {
						yield { type: "text-delta", text: "同一张表已同步" }
						yield { type: "finish", reason: "stop" }
					}
				},
			},
		})
		const result = await runtime.run("整理两条并直接填到右侧表格")
		expect(result.status, result.error?.message).toBe("completed")
		expect(changed).toContain("聊天整理第二条")
		expect(hostData(captured[1]).worksheet.view.range).toBe("C2:C3")
		expect(f.native.open).toHaveBeenCalledWith("same-session", true)
		expect(f.native.open).toHaveBeenCalledTimes(1)
		await f.table.execute("same-session", {
			action: "write",
			range: "C2",
			revision: (await f.snapshot()).revision,
			values: [["右侧用户改好的内容"]],
		})
		await runtime.run("读取刚刚表格中的修改")
		expect(hostData(captured[2]).rows[0].values.text).toBe("右侧用户改好的内容")
		expect(
			captured[2].messages.some((m) => m.content.some((p) => p.type === "text" && p.text === "整理两条并直接填到右侧表格")),
		).toBe(true)
		unsubscribe()
	})
	it("fails closed if product Batch and SDK Plan ever disagree", async () => {
		const f = fixture()
		await f.service.setEnabled("same-session", true)
		const result = await f.bridge.withHooks(undefined, "plan").beforeModel!(
			requestContext({ messages: [], tools: f.bridge.tools() }),
		)
		expect(result?.stop).toBe(true)
		expect(result?.reason).toContain("运行模式不一致")
	})
	it("preserves the bridge through real ClineCore session and provider message preparation", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "cline-batch-core-"))
		vi.stubEnv("CLINE_DATA_DIR", path.join(root, "data"))
		vi.stubEnv("CLINE_DIR", path.join(root, ".cline"))
		const workspace = path.join(root, "workspace")
		await mkdir(workspace)
		const f = fixture()
		const captured: { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] }[] = []
		const core = await ClineCore.create({
			backendMode: "local",
			clientName: "batch-integration",
			fetch: (async (_url, init) => {
				captured.push(JSON.parse(String(init?.body)))
				const chunk = {
					id: "local-fixture",
					object: "chat.completion.chunk",
					created: 1,
					model: "batch-test",
					choices: [{ index: 0, delta: { role: "assistant", content: "已收到。" }, finish_reason: null }],
				}
				return new Response(
					`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
					{ headers: { "Content-Type": "text/event-stream" } },
				)
			}) as typeof fetch,
		})
		try {
			const session = await core.start({
				interactive: true,
				localRuntime: { configExtensions: [] },
				config: {
					cwd: workspace,
					sessionId: "same-session",
					providerId: "openai-compatible",
					modelId: "batch-test",
					apiKey: "test-only",
					baseUrl: "http://127.0.0.1:1/v1",
					mode: "act",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
					systemPrompt: f.bridge.withSystemPrompt("Act integration test"),
					extraTools: f.bridge.tools(),
					hooks: f.bridge.withHooks(undefined),
				},
			})
			await core.send({ sessionId: session.sessionId, prompt: "你好" })
			await f.service.setEnabled("same-session", true)
			await core.send({ sessionId: session.sessionId, prompt: "推荐一个skillbot吧" })
			expect(captured.length).toBe(2)
			expect(JSON.stringify(captured[0].messages.filter((m) => m.role === "user"))).not.toContain("<cline_batch_context>")
			expect(JSON.stringify(captured[1].messages.filter((m) => m.role === "user"))).toContain("<cline_batch_context>")
			expect(JSON.stringify(captured[1].messages)).toContain("你好")
			expect(captured[1].tools?.some((t) => t.function.name === "loomloom_list_skillbots")).toBe(true)
			expect((await f.snapshot()).agentContext?.phase).toBe("selecting")
		} finally {
			await core.dispose()
			vi.unstubAllEnvs()
		}
	}, 20000)
	it("stops instead of silently acting like ordinary Act when the Batch tool set is missing", async () => {
		const f = fixture()
		await f.service.setEnabled("same-session", true)
		const result = await f.bridge.withHooks(undefined).beforeModel!(
			requestContext({ messages: [], tools: [], options: { metadata: { sessionId: "same-session" } } }),
		)
		expect(result?.stop).toBe(true)
		expect(result?.reason).toContain("未完整载入")
	})
	it("projects UI changes before EACH real SDK inference without rebuilding or polluting chat history", async () => {
		const f = fixture()
		const requests: AgentModelRequest[] = []
		const model: AgentModel = {
			async *stream(request) {
				requests.push(request)
				yield { type: "text-delta", text: "response" }
				yield { type: "finish", reason: "stop" }
			},
		}
		const runtime = createAgentRuntime({
			model,
			sessionId: "same-session",
			conversationId: "same-session",
			systemPrompt: f.bridge.withSystemPrompt("Original Act instructions"),
			tools: f.bridge.tools(),
			hooks: f.bridge.withHooks(undefined),
		})
		await runtime.run("你好")
		expect(hostData(requests[0])).toBeUndefined()
		expect(requests[0].tools.some((t) => t.name.startsWith("loomloom_"))).toBe(false)
		await f.service.setEnabled("same-session", true)
		await runtime.run("推荐一个skillbot吧")
		let data = hostData(requests[1])
		expect(data).toMatchObject({ productMode: "batch", taskId: "same-session", phase: "selecting", installedCount: 1 })
		expect(requests[1].tools.map((t) => t.name)).toContain("loomloom_list_skillbots")
		expect(requests[1].systemPrompt).toContain("ONE Cline Agent")
		expect(requests[1].messages.some((m) => m.content.some((p) => p.type === "text" && p.text === "你好"))).toBe(true)
		await f.service.command("same-session", { action: "select", listingId: listing.id })
		await f.service.command("same-session", { action: "quantity", revision: (await f.snapshot()).revision, count: 2 })
		let state = await f.snapshot()
		await f.service.command("same-session", {
			action: "patch",
			revision: state.revision,
			rows: state.rows.map((row, i) => ({ id: row.id, values: { text: `表单已填写${i}` } })),
		})
		await runtime.run("你知道我刚填了什么吗？")
		data = hostData(requests[2])
		state = await f.snapshot()
		expect(data.quantity).toBe(2)
		expect(data.rows[0].values.text).toBe("表单已填写0")
		expect(data.revision).toBe(state.revision)
		expect(state.agentContext?.revision).toBe(state.revision)
		await f.service.command("same-session", { action: "review", revision: state.revision })
		const quoted = await f.service.command("same-session", { action: "quote", revision: state.revision })
		await f.service.command("same-session", { action: "execute", revision: state.revision, quoteId: quoted.quote!.id })
		await f.service.command("same-session", { action: "refreshRun" })
		const finished = await runtime.run("刚才那批结果怎么样？")
		data = hostData(requests[3])
		expect(data.run.runId).toBe("same-conversation-run")
		expect(data.run.results[0].artifacts[0].inlineText).toBe("云端真实返回值的测试替身")
		expect(
			finished.messages.some((m) => m.content.some((p) => p.type === "text" && p.text.startsWith("<cline_batch_context>"))),
		).toBe(false)
		await f.service.setEnabled("same-session", false)
		await runtime.run("继续普通编程任务")
		expect(hostData(requests[4])).toBeUndefined()
		expect(requests[4].tools.some((t) => t.name.startsWith("loomloom_"))).toBe(false)
	})
	it("executes an Agent draft tool through the SDK and feeds the resulting state into its next iteration and UI", async () => {
		const f = fixture()
		await f.service.setEnabled("same-session", true)
		await f.service.command("same-session", { action: "select", listingId: listing.id })
		await f.service.command("same-session", { action: "quantity", revision: (await f.snapshot()).revision, count: 2 })
		const captured: AgentModelRequest[] = []
		const model: AgentModel = {
			async *stream(request): AsyncGenerator<AgentModelEvent> {
				captured.push(request)
				const data = hostData(request)
				if (captured.length === 1) {
					yield {
						type: "tool-call-delta",
						toolCallId: "patch-1",
						toolName: "loomloom_update_draft",
						input: {
							revision: data.revision,
							rows: data.rows.map((row: { id: string }, i: number) => ({
								id: row.id,
								values: { text: `Agent整理${i}` },
							})),
						},
					}
					yield { type: "finish", reason: "tool-calls" }
				} else {
					yield { type: "text-delta", text: "已整理，请检查输入表。" }
					yield { type: "finish", reason: "stop" }
				}
			},
		}
		const runtime = createAgentRuntime({
			model,
			sessionId: "same-session",
			conversationId: "same-session",
			tools: f.bridge.tools(),
			hooks: f.bridge.withHooks(undefined),
		})
		const result = await runtime.run("帮我整理两份素材")
		expect(result.status, result.error?.message).toBe("completed")
		expect(captured).toHaveLength(2)
		expect(hostData(captured[1]).rows[0].values.text).toBe("Agent整理0")
		expect((await f.snapshot()).rows[0].values.text).toBe("Agent整理0")
		expect((await f.snapshot()).events.at(-1)?.actor).toBe("agent")
	})
	it("starts one row on conversational selection and expands through the same state machine without paid commands", async () => {
		const f = fixture()
		await f.service.setEnabled("same-session", true)
		const tools = f.bridge.tools()
		const context = { sessionId: "same-session", agentId: "cline", iteration: 1 } as AgentToolContext
		const prepare = tools.find((t) => t.name === "loomloom_prepare_batch")!
		await prepare.execute({ action: "select", listingId: listing.id, revision: 0 }, context)
		expect((await f.snapshot()).phase).toBe("collecting")
		expect((await f.snapshot()).rows).toHaveLength(1)
		await prepare.execute({ action: "quantity", count: 3, revision: (await f.snapshot()).revision }, context)
		expect((await f.snapshot()).rows).toHaveLength(3)
		expect(await prepare.execute({ action: "execute", revision: 2 }, context)).toHaveProperty("error")
		await expect(f.service.command("same-session", { action: "quote", revision: 2 }, "agent")).rejects.toThrow("用户确认")
		expect(tools.map((t) => t.name)).not.toContain("loomloom_execute")
	})
	it("preserves prior hooks and cannot leak the active draft into a different session", async () => {
		const f = fixture()
		await f.service.setEnabled("same-session", true)
		const request: AgentModelRequest = {
			messages: [],
			tools: f.bridge.tools(),
			options: { metadata: { sessionId: "different-session" } },
		}
		const hooks = f.bridge.withHooks({ beforeModel: async () => ({ options: { testMetadata: true } }) })
		const result = await hooks.beforeModel!(requestContext(request))
		expect(result?.tools?.some((t) => t.name.startsWith("loomloom_"))).toBe(false)
		expect(result?.messages).toHaveLength(0)
		expect(result?.options).toEqual({ testMetadata: true })
	})
})
