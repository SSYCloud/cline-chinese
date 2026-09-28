import { randomUUID } from "node:crypto"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"
import type { BatchLocalOutput, BatchOutputDestination, BatchSession, BatchTableHostAction } from "@shared/loomloom"
import type { WebviewMessage } from "@shared/WebviewMessage"
import * as vscode from "vscode"
import type { Controller } from "@/core/controller"
import { getRequestRegistry, handleGrpcRequest, handleGrpcRequestCancel } from "@/core/controller/grpc-handler"
import { sendAddToInputEvent } from "@/core/controller/ui/subscribeToAddToInput"
import { getNonce } from "@/core/webview/getNonce"
import { ExtensionRegistryInfo } from "@/registry"
import { classifyInlineText } from "@/services/loomloom/output-file-adapter"
import { assertSafeMediaUrl } from "@/services/loomloom/output-media-adapter"
import { validateBatchTableRequest } from "@/services/loomloom/table-panel-policy"

const PREVIEW_MEDIA_MIMES = new Set([
	"image/jpeg",
	"image/png",
	"image/webp",
	"image/gif",
	"image/avif",
	"video/mp4",
	"video/webm",
])

function runDestination(session: BatchSession, runId: string): BatchOutputDestination | undefined {
	return runId === session.attempt?.runId
		? session.attempt.outputDestination
		: session.pastRuns?.find((run) => run.runId === runId)?.outputDestination
}

function inside(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate)
	return !!relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/** Never trust a path from cloud output metadata or the worksheet request. */
async function verifiedSavedPath(destination: BatchOutputDestination, saved: BatchLocalOutput): Promise<string> {
	if (saved.status !== "saved" || !saved.path) throw new Error("产物尚未保存到本地。")
	const rootPath = destination.outputRootDirectory ?? path.join(destination.baseDirectory, ".cline", "loomloom-outputs")
	if (!path.isAbsolute(rootPath)) throw new Error("产物目录无效。")
	const rootInfo = await lstat(rootPath)
	if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error("产物目录已被替换。")
	const root = await realpath(rootPath)
	const lexical = path.resolve(saved.path)
	if (!inside(rootPath, lexical)) throw new Error("产物路径超出本批保存目录。")
	let parent = rootPath
	for (const segment of path.relative(rootPath, lexical).split(path.sep).slice(0, -1)) {
		parent = path.join(parent, segment)
		const info = await lstat(parent)
		if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("产物目录在打开时发生变化。")
	}
	const fileInfo = await lstat(lexical)
	if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw new Error("产物文件已被替换。")
	const resolved = await realpath(lexical)
	if (!inside(root, resolved)) throw new Error("产物实际路径超出本批保存目录。")
	return resolved
}

/** Native editor tabs over the EXISTING controller. Never constructs a WebviewProvider or SDK session. */
export class BatchTablePanel {
	private panels = new Map<string, vscode.WebviewPanel>()
	private panelIds = new Map<string, string>()
	private draftProbes = new Map<
		string,
		{
			taskId: string
			panelId: string
			resolve: (dirty: boolean) => void
			reject: (reason: Error) => void
			timer: NodeJS.Timeout
		}
	>()
	private disposed = false
	constructor(
		private readonly controller: Controller,
		private readonly extensionPath: string,
	) {
		// Paid actions hold BatchService's task lock. This direct Webview handshake
		// checks a just-started local edit even before its async lease RPC arrives.
		this.controller.batch?.setWorksheetDraftProbe?.((taskId) => this.probeDraft(taskId))
	}
	private async probeDraft(taskId: string): Promise<boolean> {
		const panel = this.panels.get(taskId)
		const panelId = this.panelIds.get(taskId)
		// A hidden Webview may retain a draft in setState even if its renderer is
		// unloaded. An unanswered probe must fail closed, not assume clean input.
		if (!panel || !panelId) return false
		if (panel.visible === false) throw new Error("Batch 工作表已隐藏，请重新打开或关闭后再继续。")
		const requestId = randomUUID()
		return new Promise<boolean>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.draftProbes.delete(requestId)
				reject(new Error("Batch 工作表未响应输入状态核对。"))
			}, 2000)
			this.draftProbes.set(requestId, { taskId, panelId, resolve, reject, timer })
			void panel.webview.postMessage({ type: "batch_table_draft_probe", panelId, requestId }).then(
				(delivered) => {
					if (delivered) return
					const pending = this.draftProbes.get(requestId)
					if (!pending) return
					clearTimeout(pending.timer)
					this.draftProbes.delete(requestId)
					pending.reject(new Error("Batch 工作表不可用，请重新打开。"))
				},
				(cause) => {
					const pending = this.draftProbes.get(requestId)
					if (!pending) return
					clearTimeout(pending.timer)
					this.draftProbes.delete(requestId)
					pending.reject(cause instanceof Error ? cause : new Error("Batch 工作表状态核对失败。"))
				},
			)
		})
	}
	private finishDraftProbes(taskId: string) {
		for (const [requestId, pending] of this.draftProbes) {
			if (pending.taskId !== taskId) continue
			clearTimeout(pending.timer)
			this.draftProbes.delete(requestId)
			pending.reject(new Error("Batch 工作表已关闭，请重试。"))
		}
	}
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
		const panelId = randomUUID()
		this.panelIds.set(taskId, panelId)
		const requests = new Set<string>()
		const cancelled = new Set<string>()
		let disposed = false
		const post = (message: Parameters<typeof panel.webview.postMessage>[0]) => panel.webview.postMessage(message)
		panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
			if (disposed) return
			const probe = message as unknown as {
				type?: string
				panelId?: string
				requestId?: string
				dirty?: boolean
			}
			if (probe.type === "batch_table_draft_probe_response") {
				const pending = typeof probe.requestId === "string" ? this.draftProbes.get(probe.requestId) : undefined
				if (pending?.taskId === taskId && pending.panelId === panelId && probe.panelId === panelId) {
					clearTimeout(pending.timer)
					if (probe.requestId) this.draftProbes.delete(probe.requestId)
					pending.resolve(probe.dirty !== false)
				}
				return
			}
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
			this.finishDraftProbes(taskId)
			for (const id of requests) getRequestRegistry().cancelRequest(id)
			requests.clear()
			this.panels.delete(taskId)
			this.panelIds.delete(taskId)
			// A hidden Webview can retain an unsaved draft. Only closing its native
			// panel may abandon the edit lease and re-enable paid actions.
			const release = this.controller.batch?.releaseWorksheetEditLease(taskId, panelId)
			void release?.catch(() => {
				/* Disposing the view must not surface an unhandled rejection. */
			})
		})
		const nonce = getNonce(),
			asset = (name: string) =>
				panel.webview.asWebviewUri(vscode.Uri.file(path.join(this.extensionPath, "webview-ui", "build", "assets", name)))
		const bootstrap = JSON.stringify({ taskId, panelId }).replace(/</g, "\\u003c")
		panel.webview.html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; media-src ${panel.webview.cspSource}; font-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${asset("batch.css")}"><title>Batch 表格</title></head><body><div id="root"></div><script nonce="${nonce}">window.__CLINE_BATCH_PANEL__=${bootstrap};</script><script type="module" nonce="${nonce}" src="${asset("batch.js")}"></script></body></html>`
	}
	private async chooseOutputRoot(): Promise<string | undefined> {
		const selected = await vscode.window.showOpenDialog({
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: "选择产物保存目录",
		})
		const uri = selected?.[0]
		if (!uri) return undefined
		if (uri.scheme !== "file" || !path.isAbsolute(uri.fsPath)) throw new Error("请选择本机上的文件夹。")
		const info = await lstat(uri.fsPath)
		if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("产物保存目录不能是文件或符号链接。")
		return realpath(uri.fsPath)
	}
	async action(input: BatchTableHostAction) {
		if (input.action === "chooseOutputDirectory") {
			if (this.controller.task?.taskId !== input.taskId) throw new Error("请先打开这张工作表所属的 Cline 会话。")
			const selected = await this.chooseOutputRoot()
			if (!selected) return { cancelled: true }
			const destination = await this.controller.batch.setOutputRootDirectory(input.taskId, selected)
			return { directory: destination.outputRootDirectory ?? destination.baseDirectory }
		}
		if (input.action === "exportRunToDirectory") {
			if (!input.runId) throw new Error("请先选择要另存的批次。")
			const selected = await this.chooseOutputRoot()
			if (!selected) return { cancelled: true }
			await this.controller.batch.rebindRunOutputDirectory(input.taskId, input.runId, selected)
			await this.controller.batchOutputs.ensure(input.taskId, input.runId, true)
			const session = await this.controller.batch.snapshot(input.taskId)
			const records = session?.localOutputs?.filter((record) => record.runId === input.runId) ?? []
			return {
				directory: selected,
				saved: records.filter((record) => record.status === "saved").length,
				failed: records.filter((record) => record.status === "error").length,
			}
		}
		if (input.action === "previewArtifact") {
			if (!input.runId || input.rowIndex === undefined || input.artifactIndex === undefined)
				throw new Error("请选择要预览的产物单元格。")
			const panel = this.panels.get(input.taskId)
			if (!panel) throw new Error("请先打开这张 Batch 工作表。")
			const session = await this.controller.batch.snapshot(input.taskId)
			if (!session) throw new Error("找不到这条 Batch 会话。")
			const destination = runDestination(session, input.runId)
			if (!destination) throw new Error("本批尚未设置产物保存目录，请先选择目录。")
			const rows =
				input.runId === session.attempt?.runId
					? session.results
					: session.pastRuns?.find((run) => run.runId === input.runId)?.results
			const artifact = rows?.find((row) => row.rowIndex === input.rowIndex)?.artifacts?.[input.artifactIndex]
			if (!artifact) throw new Error("此单元格没有可预览的产物。")
			await this.controller.batchOutputs.ensure(input.taskId, input.runId)
			let saved = (await this.controller.batch.snapshot(input.taskId))?.localOutputs?.find(
				(record) =>
					record.runId === input.runId &&
					record.rowIndex === input.rowIndex &&
					record.artifactIndex === input.artifactIndex,
			)
			if (saved?.status === "error") {
				await this.controller.batchOutputs.ensure(input.taskId, input.runId, true)
				saved = (await this.controller.batch.snapshot(input.taskId))?.localOutputs?.find(
					(record) =>
						record.runId === input.runId &&
						record.rowIndex === input.rowIndex &&
						record.artifactIndex === input.artifactIndex,
				)
			}
			if (!saved || saved.status !== "saved")
				throw new Error(saved?.error || "媒体尚未保存到本地，请刷新结果或另存本批后重试。")
			const mediaMime = saved.mimeType?.split(";", 1)[0]?.trim().toLowerCase()
			if (!PREVIEW_MEDIA_MIMES.has(mediaMime ?? "")) throw new Error("此单元格不是可在工作表预览的图片或视频。")
			const file = await verifiedSavedPath(destination, saved)
			const build = vscode.Uri.file(path.join(this.extensionPath, "webview-ui", "build"))
			panel.webview.options = {
				...panel.webview.options,
				localResourceRoots: [build, vscode.Uri.file(path.dirname(file))],
			}
			return {
				uri: panel.webview.asWebviewUri(vscode.Uri.file(file)).toString(),
				mimeType: mediaMime,
				relativePath: saved.relativePath,
			}
		}
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
				const destination = runDestination(session, runId)
				if (saved?.path && destination) {
					const resolved = await verifiedSavedPath(destination, saved)
					if (PREVIEW_MEDIA_MIMES.has(saved.mimeType?.split(";", 1)[0]?.trim().toLowerCase() ?? "")) {
						await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(resolved))
						return
					}
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
			return
		}
		if (artifact.accessUrl) {
			const url = assertSafeMediaUrl(artifact.accessUrl)
			await vscode.env.openExternal(vscode.Uri.parse(url.href))
			return
		}
		throw new Error("此产物暂未提供可打开的内容。")
	}
	dispose() {
		this.disposed = true
		this.controller.batch?.setWorksheetDraftProbe?.(undefined)
		for (const panel of this.panels.values()) panel.dispose()
		this.panels.clear()
		this.panelIds.clear()
	}
}
