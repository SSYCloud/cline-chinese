import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Controller } from "@/core/controller"

const f = vi.hoisted(() => ({
	create: vi.fn(),
	handle: vi.fn(),
	cancel: vi.fn(),
	cancelRequest: vi.fn(),
	text: vi.fn(),
	show: vi.fn(),
	external: vi.fn(),
	clipboard: vi.fn(),
	command: vi.fn(),
	input: vi.fn(),
	pick: vi.fn(),
}))
vi.mock("vscode", () => ({
	ViewColumn: { Beside: -2, Active: -1 },
	Uri: { file: (path: string) => path, parse: (url: string) => url },
	window: { createWebviewPanel: f.create, showTextDocument: f.show, showOpenDialog: f.pick },
	workspace: { openTextDocument: f.text },
	env: { openExternal: f.external, clipboard: { writeText: f.clipboard } },
	commands: { executeCommand: f.command },
}))
vi.mock("@/core/controller/grpc-handler", () => ({
	handleGrpcRequest: f.handle,
	handleGrpcRequestCancel: f.cancel,
	getRequestRegistry: () => ({ cancelRequest: f.cancelRequest }),
}))
vi.mock("@/core/controller/ui/subscribeToAddToInput", () => ({ sendAddToInputEvent: f.input }))
vi.mock("@/core/webview/getNonce", () => ({ getNonce: () => "test-nonce" }))

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { batchTableAction } from "@/core/controller/loomLoom/batchTableAction"
import { BatchTablePanel } from "@/hosts/vscode/BatchTablePanel"
import { saveInlineTextArtifact } from "@/services/loomloom/output-file-adapter"

let received: (m: unknown) => Promise<void>, closed: () => void
let panel: {
	reveal: ReturnType<typeof vi.fn>
	dispose: ReturnType<typeof vi.fn>
	viewColumn: number
	visible?: boolean
	webview: {
		html: string
		cspSource: string
		options: { localResourceRoots: string[] }
		asWebviewUri: (x: string) => string
		postMessage: ReturnType<typeof vi.fn>
		onDidReceiveMessage: (fn: typeof received) => void
	}
	onDidDispose: (fn: () => void) => void
}
beforeEach(() => {
	vi.clearAllMocks()
	f.handle.mockResolvedValue(undefined)
	panel = {
		reveal: vi.fn(),
		dispose: vi.fn(() => closed()),
		viewColumn: 2,
		webview: {
			html: "",
			cspSource: "vscode-webview:",
			options: { localResourceRoots: [] },
			asWebviewUri: (x) => x,
			postMessage: vi.fn(async () => true),
			onDidReceiveMessage: (fn) => {
				received = fn
			},
		},
		onDidDispose: (fn) => {
			closed = fn
		},
	}
	f.create.mockReturnValue(panel)
})
describe("Batch editor panel lifecycle", () => {
	it("uses the native folder picker for a future-run destination instead of trusting a Webview path", async () => {
		const base = await mkdtemp(path.join(process.cwd(), ".batch-destination-"))
		try {
			f.pick.mockResolvedValue([{ scheme: "file", fsPath: base }])
			const setOutputRootDirectory = vi.fn(async (_taskId: string, directory: string) => ({
				baseDirectory: directory,
				outputRootDirectory: directory,
			}))
			const controller = {
				task: { taskId: "task" },
				batch: { setOutputRootDirectory },
			} as unknown as Controller
			const host = new BatchTablePanel(controller, "D:/extension")
			expect(await host.action({ taskId: "task", action: "chooseOutputDirectory" })).toEqual({ directory: base })
			expect(setOutputRootDirectory).toHaveBeenCalledWith("task", await realpath(base))
			expect(f.pick).toHaveBeenCalledWith(
				expect.objectContaining({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false }),
			)
		} finally {
			await rm(base, { recursive: true, force: true })
		}
	})
	it("returns only the native preview descriptor through the worksheet action RPC", async () => {
		const action = vi.fn(async () => ({ uri: "vscode-resource:/owned/image.jpg", mimeType: "image/jpeg" }))
		const controller = { batchTableHost: { action } } as unknown as Controller
		const response = await batchTableAction(controller, {
			value: JSON.stringify({ taskId: "task", action: "previewArtifact", runId: "run", rowIndex: 0, artifactIndex: 0 }),
		})
		expect(JSON.parse(response.value)).toEqual({ uri: "vscode-resource:/owned/image.jpg", mimeType: "image/jpeg" })
		expect(action).toHaveBeenCalledWith({
			taskId: "task",
			action: "previewArtifact",
			runId: "run",
			rowIndex: 0,
			artifactIndex: 0,
		})
	})
	it("returns only a verified local media URI for an owned run and never the signed URL", async () => {
		const base = await mkdtemp(path.join(process.cwd(), ".batch-media-preview-"))
		try {
			const rowDirectory = path.join(base, "task-owned", "run-owned", "row-0001")
			await mkdir(rowDirectory, { recursive: true })
			const file = path.join(rowDirectory, "image.jpg")
			await writeFile(file, Buffer.from([255, 216, 255, 217]))
			const session = {
				attempt: { runId: "run-owned", outputDestination: { baseDirectory: base, outputRootDirectory: base } },
				results: [
					{
						rowIndex: 0,
						artifacts: [
							{ accessUrl: "https://media.example.invalid/signed-secret", mimeType: "application/octet-stream" },
						],
					},
				],
				localOutputs: [
					{
						runId: "run-owned",
						rowIndex: 0,
						artifactIndex: 0,
						contentHash: "hash",
						status: "saved",
						path: file,
						mimeType: "image/jpeg",
					},
				],
			}
			const controller = {
				batch: { snapshot: vi.fn(async () => session), releaseWorksheetEditLease: vi.fn(async () => {}) },
				batchOutputs: { ensure: vi.fn(async () => {}) },
			} as unknown as Controller
			const host = new BatchTablePanel(controller, "D:/extension")
			await host.open("task")
			const result = await host.action({
				taskId: "task",
				action: "previewArtifact",
				runId: "run-owned",
				rowIndex: 0,
				artifactIndex: 0,
			})
			expect(result).toMatchObject({ mimeType: "image/jpeg", uri: file })
			expect(JSON.stringify(result)).not.toContain("signed-secret")
			expect(panel.webview.options.localResourceRoots).toContain(rowDirectory)
			expect(panel.webview.html).toContain("media-src vscode-webview:")
			expect(panel.webview.html).not.toContain("img-src vscode-webview: https:")
			await expect(
				host.action({ taskId: "task", action: "previewArtifact", runId: "other-run", rowIndex: 0, artifactIndex: 0 }),
			).rejects.toThrow("保存目录")
		} finally {
			await rm(base, { recursive: true, force: true })
		}
	})
	it("refuses to open an internal network artifact URL even as an external fallback", async () => {
		const controller = {
			batch: {
				snapshot: vi.fn(async () => ({
					attempt: { runId: "run" },
					results: [{ rowIndex: 0, artifacts: [{ accessUrl: "https://127.0.0.1/private", mimeType: "image/jpeg" }] }],
				})),
			},
		} as unknown as Controller
		const host = new BatchTablePanel(controller, "D:/extension")
		await expect(
			host.action({ taskId: "task", action: "openArtifact", runId: "run", rowIndex: 0, artifactIndex: 0 }),
		).rejects.toThrow("公网 HTTPS")
		expect(f.external).not.toHaveBeenCalled()
	})
	it("sends a bounded creator draft to the original Cline composer", async () => {
		const action = vi.fn(async () => {})
		const controller = { task: { taskId: "task" }, batchTableHost: { action } } as unknown as Controller
		await batchTableAction(controller, { value: JSON.stringify({ taskId: "task", action: "cite", text: "设计私有工作流" }) })
		expect(action).toHaveBeenCalledWith({ taskId: "task", action: "cite", text: "设计私有工作流" })
		await expect(
			batchTableAction(controller, {
				value: JSON.stringify({ taskId: "another", action: "cite", text: "不属于当前任务" }),
			}),
		).rejects.toThrow("原任务")
	})
	it("loads only the dedicated worksheet assets in a VS Code editor", async () => {
		const controller = { task: { taskId: "task" } } as unknown as Controller
		await new BatchTablePanel(controller, "D:/extension").open("task", true)
		expect(panel.webview.html).toMatch(/[\\/]assets[\\/]batch\.js/)
		expect(panel.webview.html).toMatch(/[\\/]assets[\\/]batch\.css/)
		expect(panel.webview.html).not.toMatch(/[\\/]assets[\\/]index\.js/)
		expect(f.create.mock.calls[0][3].retainContextWhenHidden).toBe(false)
	})
	it("opens an auto-saved HTML file by URI instead of an untitled copy", async () => {
		const parent = await realpath(process.cwd()),
			base = await mkdtemp(path.join(parent, ".batch-panel-file-"))
		try {
			const artifact = { inlineText: "<html><body>已落盘</body></html>", mimeType: "text/html" }
			const saved = await saveInlineTextArtifact({
				baseDirectory: base,
				taskId: "task",
				runId: "run",
				rowIndex: 0,
				artifactIndex: 0,
				artifact,
			})
			const state = {
				attempt: { runId: "run", outputDestination: { baseDirectory: base } },
				results: [{ rowIndex: 0, artifacts: [artifact] }],
				localOutputs: [{ ...saved, runId: "run", rowIndex: 0, artifactIndex: 0, status: "saved" }],
			}
			const controller = {
				prepareBatchOutputDestination: vi.fn(async () => {}),
				batchOutputs: { ensure: vi.fn(async () => {}) },
				batch: { snapshot: async () => state },
			} as unknown as Controller
			await new BatchTablePanel(controller, "D:/extension").action({
				taskId: "task",
				action: "openArtifact",
				runId: "run",
				rowIndex: 0,
				artifactIndex: 0,
			})
			expect(f.text).toHaveBeenCalledWith(await realpath(saved.path))
			expect(f.external).not.toHaveBeenCalled()
			expect(f.create).not.toHaveBeenCalled()
		} finally {
			const resolved = path.resolve(base)
			if (path.dirname(resolved) === parent && path.basename(resolved).startsWith(".batch-panel-file-"))
				await rm(resolved, { recursive: true, force: true })
		}
	})
	it("does not replace a binary URL artifact with an empty text editor", async () => {
		const controller = {
			batch: {
				snapshot: async () => ({
					attempt: { runId: "run" },
					results: [
						{
							rowIndex: 0,
							artifacts: [
								{ inlineText: "", mimeType: "image/png", accessUrl: "https://example.invalid/output.png" },
							],
						},
					],
				}),
			},
		} as unknown as Controller
		await new BatchTablePanel(controller, "D:/extension").action({
			taskId: "task",
			action: "openArtifact",
			runId: "run",
			rowIndex: 0,
			artifactIndex: 0,
		})
		expect(f.text).not.toHaveBeenCalled()
		expect(f.external).toHaveBeenCalledWith("https://example.invalid/output.png")
	})
	it("keeps task-pinned tabs distinct and reuses the original tab without closing others", async () => {
		f.create.mockImplementation(() => ({ ...panel, reveal: vi.fn(), dispose: vi.fn(), webview: { ...panel.webview } }))
		const controller = { task: { taskId: "task-A" } } as unknown as Controller
		const host = new BatchTablePanel(controller, "D:/extension")
		await host.open("task-A")
		await host.open("task-B")
		await host.open("task-A", true)
		expect(f.create).toHaveBeenCalledTimes(2)
		expect(f.create.mock.calls.map((call) => call[1])).toEqual(["Batch 工作表 · task-A", "Batch 工作表 · task-B"])
		expect(f.create.mock.results[0].value.reveal).toHaveBeenCalledWith(undefined, true)
		expect(f.create.mock.results[1].value.dispose).not.toHaveBeenCalled()
	})

	it("ignores late automatic opens for an inactive task while allowing deliberate historical viewing", async () => {
		const controller = { task: { taskId: "B" } } as unknown as Controller
		const host = new BatchTablePanel(controller, "D:/extension")
		await host.open("A", true)
		expect(f.create).not.toHaveBeenCalled()
		await host.open("A")
		expect(f.create).toHaveBeenCalledTimes(1)
		await host.open("A", true)
		expect(panel.reveal).not.toHaveBeenCalled()
	})

	it("does not create a table after the native host is disposed", async () => {
		const host = new BatchTablePanel({} as Controller, "D:/extension")
		host.dispose()
		await host.open("A")
		expect(f.create).not.toHaveBeenCalled()
	})

	it("explicitly returns to the pinned original conversation before focusing chat", async () => {
		const controller = {
			task: { taskId: "B" },
			showTaskWithId: vi.fn(async (taskId: string) => {
				controller.task = { taskId }
			}),
		}
		const host = new BatchTablePanel(controller as unknown as Controller, "D:/extension")
		await host.action({ taskId: "A", action: "focusChat" })
		expect(controller.showTaskWithId).toHaveBeenCalledWith("A")
		expect(controller.task.taskId).toBe("A")
		expect(f.command).toHaveBeenCalledTimes(1)
	})

	it("does not focus a different chat when a newer selection supersedes return-to-origin", async () => {
		const controller = { task: { taskId: "B" }, showTaskWithId: vi.fn(async () => {}) }
		const host = new BatchTablePanel(controller as unknown as Controller, "D:/extension")
		await expect(host.action({ taskId: "A", action: "focusChat" })).rejects.toThrow("会话已切换")
		expect(f.command).not.toHaveBeenCalled()
	})

	it("reuses one editor over the original controller and never tears down its Agent", async () => {
		const dispose = vi.fn(),
			releaseWorksheetEditLease = vi.fn().mockResolvedValue(undefined),
			controller = {
				task: { taskId: "task" },
				dispose,
				batch: { dispose, releaseWorksheetEditLease },
			} as unknown as Controller
		const host = new BatchTablePanel(controller, "D:/extension")
		await host.open("task", true)
		await host.open("task", true)
		expect(f.create).toHaveBeenCalledTimes(1)
		expect(panel.reveal).toHaveBeenCalledWith(undefined, true)
		expect(panel.webview.html).toMatch(/__CLINE_BATCH_PANEL__=\{"taskId":"task","panelId":"[0-9a-f-]+"\}/)
		expect(panel.webview.html).toContain("nonce-test-nonce")
		await received({
			type: "grpc_request",
			grpc_request: {
				service: "cline.LoomLoomService",
				method: "worksheetOperation",
				is_streaming: false,
				request_id: "r",
				message: { value: JSON.stringify({ taskId: "task", operation: { action: "read" } }) },
			},
		})
		expect(f.handle.mock.calls[0][0]).toBe(controller)
		host.dispose()
		expect(dispose).not.toHaveBeenCalled()
		expect(releaseWorksheetEditLease).toHaveBeenCalledWith("task", expect.any(String))
	})
	it("probes a visible worksheet directly before a paid action can use its old input", async () => {
		const setWorksheetDraftProbe = vi.fn()
		const controller = {
			batch: { setWorksheetDraftProbe, releaseWorksheetEditLease: vi.fn().mockResolvedValue(undefined) },
		} as unknown as Controller
		const host = new BatchTablePanel(controller, "D:/extension")
		panel.visible = true
		await host.open("task")
		const probe = setWorksheetDraftProbe.mock.calls[0][0] as (taskId: string) => Promise<boolean>
		const pending = probe("task")
		const request = panel.webview.postMessage.mock.calls.at(-1)?.[0] as {
			type: string
			panelId: string
			requestId: string
		}
		expect(request.type).toBe("batch_table_draft_probe")
		await received({
			type: "batch_table_draft_probe_response",
			panelId: request.panelId,
			requestId: request.requestId,
			dirty: true,
		})
		expect(await pending).toBe(true)
		panel.visible = false
		await expect(probe("task")).rejects.toThrow("已隐藏")
		host.dispose()
	})
	it("cancels a stream even when the editor closes before async registration finishes", async () => {
		let release!: () => void
		f.handle.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve
				}),
		)
		const host = new BatchTablePanel({} as Controller, "D:/extension")
		await host.open("task")
		const request = received({
			type: "grpc_request",
			grpc_request: {
				service: "cline.LoomLoomService",
				method: "subscribeBatchTable",
				is_streaming: true,
				request_id: "stream",
				message: { value: JSON.stringify({ taskId: "task" }) },
			},
		})
		closed()
		expect(f.cancelRequest).toHaveBeenCalledWith("stream")
		f.cancelRequest.mockClear()
		release()
		await request
		expect(f.cancelRequest).toHaveBeenCalledWith("stream")
	})
	it("rejects requests for other tasks without dispatching", async () => {
		const host = new BatchTablePanel({} as Controller, "D:/extension")
		await host.open("task")
		await received({
			type: "grpc_request",
			grpc_request: {
				service: "cline.LoomLoomService",
				method: "worksheetOperation",
				is_streaming: false,
				request_id: "wrong",
				message: { value: JSON.stringify({ taskId: "other", operation: { action: "write" } }) },
			},
		})
		expect(f.handle).not.toHaveBeenCalled()
		expect(panel.webview.postMessage).toHaveBeenCalledWith(
			expect.objectContaining({ grpc_response: expect.objectContaining({ error: expect.stringContaining("原任务") }) }),
		)
	})
	it("opens HTML as editor text, never as another executable Webview", async () => {
		const content = "<script>untrusted()</script>"
		const controller = {
			batch: {
				snapshot: async () => ({
					attempt: { runId: "run" },
					results: [{ rowIndex: 0, artifacts: [{ inlineText: content, mimeType: "text/html" }] }],
				}),
			},
		} as unknown as Controller
		const host = new BatchTablePanel(controller, "D:/extension")
		await host.action({ taskId: "task", action: "openArtifact", runId: "run", rowIndex: 0, artifactIndex: 0 })
		expect(f.text).toHaveBeenCalledWith({ content, language: "html" })
		expect(f.create).not.toHaveBeenCalled()
		expect(f.external).not.toHaveBeenCalled()
	})
})
