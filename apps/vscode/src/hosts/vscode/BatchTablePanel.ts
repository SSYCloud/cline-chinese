import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import type { BatchTableHostAction } from "@shared/loomloom"
import type { WebviewMessage } from "@shared/WebviewMessage"
import * as vscode from "vscode"
import type { Controller } from "@/core/controller"
import { getRequestRegistry, handleGrpcRequest, handleGrpcRequestCancel } from "@/core/controller/grpc-handler"
import { sendAddToInputEvent } from "@/core/controller/ui/subscribeToAddToInput"
import { getNonce } from "@/core/webview/getNonce"
import { ExtensionRegistryInfo } from "@/registry"
import { classifyInlineText } from "@/services/loomloom/output-file-adapter"
import { validateBatchTableRequest } from "@/services/loomloom/table-panel-policy"

/** Native editor tabs over the EXISTING controller. Never constructs a WebviewProvider or SDK session. */
export class BatchTablePanel {
	private panels = new Map<string, vscode.WebviewPanel>()
	private disposed = false
	constructor(
		private readonly controller: Controller,
		private readonly extensionPath: string,
	) {}
	async open(taskId: string, preserveFocus = false) {
		// Automatic/Agent requests can settle after the user switches conversations.
		if (this.disposed || (preserveFocus && this.controller.task?.taskId !== taskId)) return
		const existing = this.panels.get(taskId)
		if (existing) {
			existing.reveal(undefined, preserveFocus)
			return
		}
		const shortId = taskId.length > 12 ? `${taskId.slice(0, 6)}…${taskId.slice(-6)}` : taskId
		const panel = vscode.window.createWebviewPanel(
			"cline.batchTable",
			`Batch 工作表 · ${shortId}`,
			{ viewColumn: vscode.ViewColumn.Beside, preserveFocus },
			{
				enableScripts: true,
				// VS Code restores the small unsaved cell draft with getState/setState.
				// Keeping every task-pinned React editor alive would multiply memory use.
				retainContextWhenHidden: false,
				localResourceRoots: [vscode.Uri.file(path.join(this.extensionPath, "webview-ui", "build"))],
			},
		)
		this.panels.set(taskId, panel)
		const requests = new Set<string>()
		const cancelled = new Set<string>()
		let disposed = false
		const post = (message: Parameters<typeof panel.webview.postMessage>[0]) => panel.webview.postMessage(message)
		panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			if (disposed) return
			if (message.type === "grpc_request_cancel" && message.grpc_request_cancel) {
				if (requests.delete(message.grpc_request_cancel.request_id)) {
					cancelled.add(message.grpc_request_cancel.request_id)
					await handleGrpcRequestCancel(post, message.grpc_request_cancel)
				}
				return
			}
			const request = message.type === "grpc_request" ? message.grpc_request : undefined
			if (!request) return
			try {
				validateBatchTableRequest(taskId, request)
				if (request.is_streaming) requests.add(request.request_id)
				await handleGrpcRequest(this.controller, post, request)
				if (disposed || cancelled.delete(request.request_id)) getRequestRegistry().cancelRequest(request.request_id)
			} catch (error) {
				await post({
					type: "grpc_response",
					grpc_response: {
						request_id: request.request_id,
						error: error instanceof Error ? error.message : "表格操作失败",
						is_streaming: false,
					},
				})
			}
		})
		panel.onDidDispose(() => {
			disposed = true
			for (const id of requests) getRequestRegistry().cancelRequest(id)
			requests.clear()
			this.panels.delete(taskId)
		})
		const nonce = getNonce(),
			asset = (name: string) =>
				panel.webview.asWebviewUri(vscode.Uri.file(path.join(this.extensionPath, "webview-ui", "build", "assets", name)))
		const bootstrap = JSON.stringify({ taskId }).replace(/</g, "\\u003c")
		panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} https: data:; font-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset("batch.css")}"><title>Batch 表格</title></head><body><div id="root"></div><script nonce="${nonce}">window.__CLINE_BATCH_PANEL__=${bootstrap};</script><script type="module" nonce="${nonce}" src="${asset("batch.js")}"></script></body></html>`
	}
	async action(input: BatchTableHostAction) {
		if (input.action === "saveOutputs") {
			const session = await this.controller.batch.snapshot(input.taskId)
			const runId = input.runId ?? session?.attempt?.runId
			if (!runId) throw new Error("暂无可保存的运行结果。")
			await this.controller.prepareBatchOutputDestination(input.taskId, runId)
			await this.controller.batchOutputs.ensure(input.taskId, runId, true)
			return
		}
		if (input.action === "copyText") {
			await vscode.env.clipboard.writeText(input.text ?? "")
			return
		}
		if (input.action === "cite") {
			if (this.controller.task?.taskId !== input.taskId) throw new Error("请先打开原任务。")
			await vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)
			await sendAddToInputEvent(input.text ?? "")
			return
		}
		if (input.action === "focusChat") {
			if (this.controller.task?.taskId !== input.taskId) await this.controller.showTaskWithId(input.taskId)
			if (this.controller.task?.taskId !== input.taskId) throw new Error("会话已切换，请重新打开原对话。")
			await vscode.commands.executeCommand(`${ExtensionRegistryInfo.views.Sidebar}.focus`)
			return
		}
		let session = await this.controller.batch.snapshot(input.taskId)
		if (!session) throw new Error("Batch 数据不存在。")
		const runId = input.runId ?? session.attempt?.runId
		// Materialize through the host-owned mapping, never through cloud-supplied path fields.
		if (runId && this.controller.batchOutputs) {
			try {
				await this.controller.prepareBatchOutputDestination(input.taskId, runId)
				await this.controller.batchOutputs.ensure(input.taskId, runId)
				session = (await this.controller.batch.snapshot(input.taskId)) ?? session
				let saved = session.localOutputs?.find(
					(file) =>
						file.runId === runId &&
						file.rowIndex === input.rowIndex &&
						file.artifactIndex === (input.artifactIndex ?? 0) &&
						file.status === "saved",
				)
				if (saved?.path) {
					try {
						await lstat(saved.path)
					} catch (error) {
						if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
						await this.controller.batchOutputs.ensure(input.taskId, runId, true)
						session = (await this.controller.batch.snapshot(input.taskId)) ?? session
						saved = session.localOutputs?.find(
							(file) =>
								file.runId === runId &&
								file.rowIndex === input.rowIndex &&
								file.artifactIndex === (input.artifactIndex ?? 0) &&
								file.status === "saved",
						)
					}
				}
				const destination =
					runId === session.attempt?.runId
						? session.attempt.outputDestination
						: session.pastRuns?.find((run) => run.runId === runId)?.outputDestination
				if (saved?.path && destination) {
					const fileInfo = await lstat(saved.path)
					if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw new Error("本地产物路径已被替换，拒绝打开。")
					const base = await realpath(destination.baseDirectory),
						root = await realpath(path.join(destination.baseDirectory, ".cline", "loomloom-outputs")),
						resolved = await realpath(saved.path),
						relative = path.relative(root, resolved)
					const fromBase = path.relative(base, resolved)
					if (!fromBase || fromBase === ".." || fromBase.startsWith(`..${path.sep}`) || path.isAbsolute(fromBase))
						throw new Error("本地产物实际路径超出原任务目录。")
					let parent = base
					const lexicalFromBase = path.relative(base, path.resolve(saved.path))
					if (
						!lexicalFromBase ||
						lexicalFromBase === ".." ||
						lexicalFromBase.startsWith(`..${path.sep}`) ||
						path.isAbsolute(lexicalFromBase)
					)
						throw new Error("本地产物路径超出原任务目录。")
					for (const segment of lexicalFromBase.split(path.sep).slice(0, -1)) {
						parent = path.join(parent, segment)
						const stat = await lstat(parent)
						if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("本地产物目录已被替换。")
					}
					if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
						throw new Error("本地产物不在此运行的保存目录内。")
					const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resolved))
					await vscode.window.showTextDocument(document, {
						preview: false,
						viewColumn: this.panels.get(input.taskId)?.viewColumn ?? vscode.ViewColumn.Active,
					})
					return
				}
			} catch {
				// Local saving is optional to viewing. Retain the original inert-text fallback below.
			}
		}
		const rows =
			input.runId && input.runId !== session.attempt?.runId
				? session.pastRuns?.find((run) => run.runId === input.runId)?.results
				: session.results
		const artifact = rows?.find((row) => row.rowIndex === input.rowIndex)?.artifacts?.[input.artifactIndex ?? 0]
		if (!artifact) throw new Error("产物已变化，请刷新后重试。")
		if (artifact.inlineText !== undefined && (classifyInlineText(artifact) || !artifact.accessUrl)) {
			const language =
				artifact.mimeType === "text/html"
					? "html"
					: artifact.mimeType === "application/json"
						? "json"
						: artifact.mimeType?.includes("markdown")
							? "markdown"
							: "plaintext"
			const document = await vscode.workspace.openTextDocument({ content: artifact.inlineText, language })
			await vscode.window.showTextDocument(document, {
				preview: false,
				viewColumn: this.panels.get(input.taskId)?.viewColumn ?? vscode.ViewColumn.Active,
			})
		} else if (artifact.accessUrl) {
			const url = new URL(artifact.accessUrl)
			if (url.protocol !== "https:" || url.username || url.password) throw new Error("产物链接不受支持。")
			await vscode.env.openExternal(vscode.Uri.parse(url.href))
		} else throw new Error("此产物暂未提供可打开的内容。")
	}
	dispose() {
		this.disposed = true
		for (const panel of this.panels.values()) panel.dispose()
		this.panels.clear()
	}
}
