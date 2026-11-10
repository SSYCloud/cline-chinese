// Replaces classic manual-condense handling from src/core/task (see origin/main)
//
// Coordinates a manual "/compact" (alias "/smol") request triggered from the
// VSCode compact button or slash command. This mirrors the CLI's
// `compactCurrentSession` (apps/cli/src/runtime/interactive/session-runtime.ts):
//
//   1. Read the session's transcript.
//   2. Run a manual SDK compaction over it (sdk-compaction.ts).
//   3. Persist the SDK compaction sidecar so the next turn and resumes keep
//      using the compacted working context.
//
// Compaction always runs against an active session. When the user compacts a
// task opened from history (a displayed, non-running task with no active
// session, including a legacy task not yet migrated), we first resume it into
// an isolated session — using the same resume preparation as the follow-up
// path, which also migrates legacy tasks — then compact it through the single
// path below. The coordinator owns this session's host, so another task can
// replace the controller's active session without compaction stopping it during
// cleanup. Resuming and compaction both run inside the session-rebuild mutex, so
// a concurrent follow-up (which awaits that mutex before choosing a host)
// cannot interleave with the read/compact/persist sequence.
//
// Before this, the VSCode button sent the literal text "/compact" to the model,
// which the SDK does not treat as a runtime command, so the model improvised a
// fake "Conversation Summary" instead of compacting (CLINE-2503).

import { type CoreCompactionContext, createSessionCompactionState } from "@cline/core"
import type { Message as SdkMessage } from "@cline/llms"
import type { ClineCompactionInfo, ClineMessage, TurnPhase } from "@shared/ExtensionMessage"
import type { Mode } from "@shared/storage/types"
import type { StateManager } from "@/core/storage/StateManager"
import { resolveTypesafeConfig } from "@/services/typesafe-compaction/config"
import { goalFromMessages, JevClient, pruneTests } from "@/services/typesafe-compaction/library"
import { createTypesafePreCompact } from "@/services/typesafe-compaction/precompact"
import { createTestFileAccess } from "@/services/typesafe-compaction/test-file-access"
import { Logger } from "@/shared/services/Logger"
import { buildCompactionMessage, parseCompactionNoticeMetadata } from "./message-translator"
import { compactSessionMessages } from "./sdk-compaction"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionConfigBuilder } from "./sdk-session-config-builder"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"
import type { SdkSessionRebuildScheduler } from "./sdk-session-rebuild-scheduler"
import type { SdkTaskHistory } from "./sdk-task-history"
import { prepareTaskResumeStartInput } from "./sdk-task-resume"
import type { SdkSessionHost } from "./session-host"

const COMPACTION_FAILURE_MESSAGE = "无法压缩对话。请重试。"
const COMPACTION_UNSUPPORTED_MESSAGE = "当前运行时尚不支持压缩功能。请更新 Cline Chinese后重试。"
const COMPACTION_TURN_RUNNING_MESSAGE = "无法在响应进行中时压缩。请在当前回合完成后重试。"
const PRUNE_DELETE_OPTION = "删除"
const PRUNE_CANCEL_OPTION = "取消"

export interface SdkCompactionCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	rebuilds: SdkSessionRebuildScheduler
	messages: SdkMessageCoordinator
	taskHistory: SdkTaskHistory
	sessionConfigBuilder: SdkSessionConfigBuilder
	/** The task currently shown in the webview (may have no active session). */
	getDisplayedTaskId: () => string | undefined
	createTempSessionHost: () => Promise<SdkSessionHost>
	loadInitialMessages: (sessionHost: SdkSessionHost, taskId: string) => Promise<unknown[] | undefined>
	getWorkspaceRoot: () => Promise<string>
	postStateToWebview: () => Promise<void>
	/**
	 * Ask the user a multiple-choice question in the chat (rendered as option buttons)
	 * and resolve with the answer text. Resolves with "" if the ask is cancelled.
	 */
	askInChat: (question: string, options: string[]) => Promise<string>
	/** Set the authoritative UI turn phase. */
	setTurnPhase: (phase: TurnPhase) => void
}

export class SdkCompactionCoordinator {
	private compactInFlight = false
	private pruneInFlight = false
	private pruneCtxInFlight = false

	constructor(private readonly options: SdkCompactionCoordinatorOptions) {}

	/**
	 * Compact the displayed task's conversation. Mirrors the CLI's `/compact`
	 * (alias `/smol`) local command. No-ops with a status message when there is
	 * nothing to compact or a turn is running.
	 */
	async compactTask(): Promise<void> {
		if (this.compactInFlight) {
			Logger.warn("[SdkController] compactTask: a compaction is already in progress; ignoring")
			return
		}

		const activeSession = this.options.sessions.getActiveSession()
		if (activeSession) {
			// A turn is still running; compacting mid-turn would race the live agent
			// loop's own message persistence. Ask the user to wait until it finishes.
			if (activeSession.isRunning) {
				this.emitInfo(COMPACTION_TURN_RUNNING_MESSAGE, activeSession.sessionId)
				await this.options.postStateToWebview()
				return
			}

			this.compactInFlight = true
			try {
				// Hold the same boundary as idle follow-up sends so a follow-up
				// cannot grow the transcript between this read/compact/persist
				// sequence and its persistence.
				await this.options.rebuilds.runExclusive(async () => {
					// Compare by sessionId, not object identity: idle rebuilds
					// (provider/MCP/terminal mode) replace the session object but
					// reuse the sessionId for the same conversation, which is what
					// the user asked to compact. Use the current host either way.
					const current = this.options.sessions.getActiveSession()
					if (current?.sessionId !== activeSession.sessionId) {
						Logger.log("[SdkController] compactTask: Target changed while waiting for the mutex; cancelling")
						return
					}
					if (current.isRunning) {
						this.emitInfo(COMPACTION_TURN_RUNNING_MESSAGE, current.sessionId)
						await this.options.postStateToWebview()
						return
					}
					await this.runCompaction(current.sdkHost, current.sessionId)
				})
			} catch (error) {
				Logger.error("[SdkController] compactTask failed:", error)
				this.emitInfo(COMPACTION_FAILURE_MESSAGE, activeSession.sessionId)
				await this.options.postStateToWebview()
			} finally {
				this.compactInFlight = false
			}
			return
		}

		const displayedTaskId = this.options.getDisplayedTaskId()
		if (!displayedTaskId) {
			Logger.warn("[SdkController] compactTask: No active session or displayed task to compact")
			this.emitInfo("There is no task to compact.")
			await this.options.postStateToWebview()
			return
		}

		this.compactInFlight = true
		try {
			await this.compactDisplayedTask(displayedTaskId)
		} catch (error) {
			Logger.error("[SdkController] compactTask failed:", error)
			this.emitInfo(COMPACTION_FAILURE_MESSAGE, displayedTaskId)
			await this.options.postStateToWebview()
		} finally {
			this.compactInFlight = false
		}
	}

	async pruneTests(): Promise<void> {
		const typesafe = resolveTypesafeConfig(this.options.stateManager)
		if (!typesafe.apiKey) {
			this.emitInfo("/pruneTests 需要先在「SystemOne」设置中配置决策模型 API Key。")
			await this.options.postStateToWebview()
			return
		}
		// The approval is an in-chat question on the displayed task. It does not need a
		// live session: a history task is enough, and the answer is routed by
		// resolvePendingAskQuestion, which runs before any session lookup.
		const active = this.options.sessions.getActiveSession()
		if (active?.isRunning) {
			this.emitInfo(COMPACTION_TURN_RUNNING_MESSAGE, active.sessionId)
			await this.options.postStateToWebview()
			return
		}
		if (!active && !this.options.getDisplayedTaskId()) {
			this.emitInfo("/pruneTests 需要在任务中执行。请先打开或新建一个任务。")
			await this.options.postStateToWebview()
			return
		}
		if (this.pruneInFlight) return
		this.pruneInFlight = true
		const sessionId = active?.sessionId
		try {
			this.emitInfo("正在评估并清理低价值单元测试…", sessionId)
			await this.options.postStateToWebview()
			const root = await this.options.getWorkspaceRoot()
			const asker = new JevClient({
				apiKey: typesafe.apiKey,
				model: typesafe.model,
				baseUrl: typesafe.baseUrl,
			})
			const threshold = typesafe.testDeleteThreshold
			// The goal steers the judge toward what the task is for. A history task has no
			// live transcript here, so it is judged with an empty goal.
			const messages = active ? ((await active.sdkHost.readMessages(active.sessionId)) as SdkMessage[]) : []
			const goal = goalFromMessages(
				messages.map((m) => ({
					role: m.role,
					text:
						typeof m.content === "string"
							? m.content
							: m.content
									.filter((b) => b.type === "text")
									.map((b) => (b as { text: string }).text)
									.join("\n"),
					toolUses: [],
				})),
			)
			const real = createTestFileAccess(root)
			const pending = new Map<string, string>()
			const result = await pruneTests(
				{
					list: () => real.list(),
					read: async (file) => pending.get(file) ?? real.read(file),
					write: async (file, text) => {
						pending.set(file, text)
					},
				},
				asker,
				{ goal, deleteThreshold: threshold },
			)
			if (result.deleted.length === 0) {
				this.emitInfo(`已扫描 ${result.tests} 个测试，没有需要删除的测试。`, sessionId)
				return
			}
			const lines = result.deleted.map((d) => `- ${d.file} › ${d.name}`)
			const question = [
				`/pruneTests 将从 ${pending.size} 个文件中删除 ${result.deleted.length} 个测试（共扫描 ${result.tests} 个）：`,
				...lines,
			].join("\n")
			const answer = await this.options.askInChat(question, [PRUNE_DELETE_OPTION, PRUNE_CANCEL_OPTION])
			if (!answer.startsWith(PRUNE_DELETE_OPTION)) {
				this.emitInfo(`已取消，未删除任何测试（候选 ${result.deleted.length} 个）。`, sessionId)
				return
			}
			for (const [file, text] of pending) {
				await real.write(file, text)
			}
			this.emitInfo(`已扫描 ${result.tests} 个测试，删除 ${result.deleted.length} 个。\n${lines.join("\n")}`, sessionId)
		} catch (error) {
			Logger.error("[SdkController] pruneTests failed:", error)
			this.emitInfo(`清理测试失败：${error instanceof Error ? error.message : String(error)}`, sessionId)
		} finally {
			this.pruneInFlight = false
			// The approval ask resolves through the follow-up path, which marks the
			// turn as streaming. No turn runs here, so return the phase to idle.
			this.options.setTurnPhase("idle")
			await this.options.postStateToWebview()
		}
	}

	/**
	 * User-triggered `/pruneCtx`: run the SystemOne (决策模型) precompact algorithm
	 * over the conversation now, instead of waiting for the automatic compaction
	 * trigger. The result is persisted as the same compaction sidecar `/compact`
	 * writes, so the next turn uses the pruned working context. No-ops with a
	 * status message when SystemOne is not configured, a turn is running, or
	 * nothing changes.
	 */
	async pruneCtx(): Promise<void> {
		const typesafe = resolveTypesafeConfig(this.options.stateManager)
		if (!typesafe.apiKey) {
			this.emitInfo("/pruneCtx 需要先在「SystemOne」设置中配置决策模型 API Key。")
			await this.options.postStateToWebview()
			return
		}
		const active = this.options.sessions.getActiveSession()
		if (active?.isRunning) {
			this.emitInfo(COMPACTION_TURN_RUNNING_MESSAGE, active.sessionId)
			await this.options.postStateToWebview()
			return
		}
		if (!active) {
			this.emitInfo("/pruneCtx 需要在已打开的任务中执行。")
			await this.options.postStateToWebview()
			return
		}
		if (this.pruneCtxInFlight || this.compactInFlight) {
			return
		}
		this.pruneCtxInFlight = true
		const sessionId = active.sessionId
		try {
			await this.options.rebuilds.runExclusive(async () => {
				const current = this.options.sessions.getActiveSession()
				if (current?.sessionId !== sessionId) {
					Logger.log("[SdkController] pruneCtx: Target changed while waiting for the mutex; cancelling")
					return
				}
				if (current.isRunning) {
					this.emitInfo(COMPACTION_TURN_RUNNING_MESSAGE, sessionId)
					await this.options.postStateToWebview()
					return
				}
				await this.runPruneCtx(current.sdkHost, sessionId, typesafe)
			})
		} catch (error) {
			Logger.error("[SdkController] pruneCtx failed:", error)
			this.emitInfo(`/pruneCtx 失败：${error instanceof Error ? error.message : String(error)}`, sessionId)
			await this.options.postStateToWebview()
		} finally {
			this.pruneCtxInFlight = false
		}
	}

	private async runPruneCtx(
		sdkHost: SdkSessionHost,
		sessionId: string,
		typesafe: ReturnType<typeof resolveTypesafeConfig>,
	): Promise<void> {
		if (!sdkHost.updateSessionCompactionState) {
			this.emitInfo(COMPACTION_UNSUPPORTED_MESSAGE, sessionId)
			await this.options.postStateToWebview()
			return
		}
		const messages = (await sdkHost.readMessages(sessionId)) as SdkMessage[]
		if (messages.length === 0) {
			this.emitInfo("No messages to prune.", sessionId)
			await this.options.postStateToWebview()
			return
		}

		const workspaceRoot = await this.options.getWorkspaceRoot()
		const preCompact = createTypesafePreCompact({
			apiKey: typesafe.apiKey,
			model: typesafe.model,
			baseUrl: typesafe.baseUrl,
			testDeleteThreshold: typesafe.testDeleteThreshold,
			contextDeleteThreshold: typesafe.contextDeleteThreshold,
			workspaceRoot,
			log: (message) => Logger.log(`[Typesafe] ${message}`),
		})
		if (!preCompact) {
			this.emitInfo("/pruneCtx 需要先在「SystemOne」设置中配置决策模型 API Key。", sessionId)
			await this.options.postStateToWebview()
			return
		}

		const messagesBefore = messages.length
		this.emitInfo("正在使用决策模型筛选上下文…", sessionId)
		await this.options.postStateToWebview()

		const result = await preCompact({
			agentId: "cline-vscode",
			conversationId: sessionId,
			parentAgentId: null,
			iteration: 0,
			messages: messages as unknown as CoreCompactionContext["messages"],
			model: { id: typesafe.model, provider: "systemone" },
			mode: "manual",
			abortSignal: new AbortController().signal,
			budget: {
				request: {
					inputTokens: 0,
					maxInputTokens: 0,
					triggerTokens: 0,
					targetTokens: 0,
					overheadTokens: 0,
					thresholdRatio: 0,
					utilizationRatio: 0,
				},
				messages: { inputTokens: 0, triggerTokens: 0, targetTokens: 0 },
			},
		})
		if (!result?.messages) {
			this.emitInfo("上下文无需精简。", sessionId)
			await this.options.postStateToWebview()
			return
		}

		const compactionState = createSessionCompactionState({
			sourceMessages: messages as unknown as CoreCompactionContext["messages"],
			compactedMessages: result.messages,
			conversationId: sessionId,
		})
		const persisted = await sdkHost.updateSessionCompactionState(sessionId, compactionState)
		if (!persisted.updated) {
			throw new Error("Compaction sidecar could not be persisted.")
		}
		this.emitInfo(`已精简上下文：${messagesBefore} → ${result.messages.length} 条消息。`, sessionId)
		await this.options.postStateToWebview()
	}

	/**
	 * Resume a displayed history task in an isolated host, compact it, then
	 * dispose the owned host so the task stays "displayed only". Runs inside the
	 * session-rebuild mutex so a concurrent follow-up cannot resume the same task
	 * in parallel; the follow-up waits, then reads the sidecar this persisted.
	 */
	private async compactDisplayedTask(taskId: string): Promise<void> {
		await this.options.rebuilds.runExclusive(async () => {
			// Another path may have made this task active while we waited for the
			// mutex. If so, compact that live session instead of resuming a second.
			const active = this.options.sessions.getActiveSession()
			if (active) {
				if (active.sessionId !== taskId) {
					Logger.log(`[SdkController] compactTask: Target changed while waiting to compact ${taskId}; cancelling`)
					return
				}
				if (active.isRunning) {
					this.emitInfo(COMPACTION_TURN_RUNNING_MESSAGE, taskId)
					await this.options.postStateToWebview()
					return
				}
				await this.runCompaction(active.sdkHost, taskId)
				return
			}

			const resumeStart = await prepareTaskResumeStartInput(this.options, taskId)
			if (this.options.sessions.getActiveSession() || this.options.getDisplayedTaskId() !== taskId) {
				Logger.log(`[SdkController] compactTask: Target changed before resuming ${taskId}; cancelling`)
				return
			}

			// Opening a task from history fires an un-awaited endActiveSession for
			// this sessionId; core cleanup is keyed by sessionId, so starting over
			// that in-flight stop would let the old session's late cleanup tear
			// down this one. Enforce the same stop-before-start as startNewSession.
			await this.options.sessions.waitForPendingStop(taskId)

			const sdkHost = await this.options.createTempSessionHost()
			let sessionId: string | undefined
			try {
				const startResult = await sdkHost.start({
					...resumeStart,
					interactive: true,
				})
				sessionId = startResult.sessionId
				// Starting may persist legacy conversion. Once it succeeds, complete
				// compaction even if navigation changes the displayed/active task. The
				// isolated host owns this session, while UI emitters fence stale rows.
				await this.runCompaction(sdkHost, sessionId)
			} finally {
				try {
					if (sessionId) {
						await sdkHost.stop(sessionId)
					}
				} finally {
					await sdkHost.dispose("compactDisplayedTask")
				}
			}
		})
	}

	private async runCompaction(sdkHost: SdkSessionHost, sessionId: string): Promise<void> {
		if (!sdkHost.updateSessionCompactionState) {
			this.emitInfo(COMPACTION_UNSUPPORTED_MESSAGE, sessionId)
			await this.options.postStateToWebview()
			return
		}
		const messages = (await sdkHost.readMessages(sessionId)) as SdkMessage[]
		const messagesBefore = messages.length
		if (messagesBefore === 0) {
			this.emitInfo("No messages to compact.", sessionId)
			await this.options.postStateToWebview()
			return
		}

		const cwd = await this.options.getWorkspaceRoot()
		const mode = this.getCurrentMode()
		const config = await this.options.sessionConfigBuilder.build({ cwd, mode })

		// A live divider row, updated in place (same ts) from "started" to its
		// terminal state — the same UX as the CLI's compaction divider.
		const compactionTs = Date.now()
		this.emitCompactionRow({ status: "started", mode: "manual" }, compactionTs, sessionId)
		await this.options.postStateToWebview()

		// The SDK reports the compaction's token/message counters through its
		// status notices; capture the terminal one for the final divider.
		let noticeInfo: ClineCompactionInfo | undefined
		try {
			const result = await compactSessionMessages({
				config: {
					providerConfig: config.providerConfig,
					providerId: config.providerId,
					modelId: config.modelId,
					knownModels: config.knownModels,
					compaction: config.compaction,
					logger: config.logger,
					telemetry: config.telemetry,
				},
				sessionId,
				messages,
				emitStatusNotice: (_message, metadata) => {
					const parsed = parseCompactionNoticeMetadata(metadata)
					if (parsed && parsed.status !== "started") {
						noticeInfo = { ...parsed, mode: "manual" }
					}
				},
			})

			if (!result.compacted) {
				this.emitCompactionRow(noticeInfo ?? { status: "skipped", mode: "manual" }, compactionTs, sessionId)
				await this.options.postStateToWebview()
				return
			}

			if (!result.compactionState) {
				throw new Error("Compaction did not return durable state.")
			}
			const persisted = await sdkHost.updateSessionCompactionState(sessionId, result.compactionState)
			if (!persisted.updated) {
				throw new Error("Compaction sidecar could not be persisted.")
			}

			this.emitCompactionRow(
				noticeInfo?.status === "completed"
					? noticeInfo
					: {
							status: "completed",
							mode: "manual",
							messagesBefore,
							messagesAfter: result.messages.length,
						},
				compactionTs,
				sessionId,
			)
			await this.options.postStateToWebview()

			Logger.log(`[SdkController] Compacted session ${sessionId}: ${messagesBefore} -> ${result.messages.length} messages`)
		} catch (error) {
			// Manual-mode counterpart of the translator's finalizeDanglingCompaction
			// (message-translator.ts), which handles auto compaction from turn
			// events — keep the terminal-state rules of the two in sync.
			this.emitCompactionRow({ status: "failed", mode: "manual" }, compactionTs, sessionId)
			await this.options.postStateToWebview()
			throw error
		}
	}

	private getCurrentMode(): Mode {
		const m = this.options.stateManager.getGlobalSettingsKey("mode")
		return m === "plan" ? m : "act"
	}

	/** Append or update-in-place (same ts) the compaction divider row. */
	private emitCompactionRow(info: ClineCompactionInfo, ts: number, sessionId: string): void {
		const targetSessionId = this.getTargetSessionId()
		if (targetSessionId !== sessionId) {
			Logger.warn(`[SdkController] compactTask: skipped compaction row for inactive session ${sessionId}`)
			return
		}
		this.options.messages.appendAndEmit([buildCompactionMessage(info, ts)], {
			type: "status",
			payload: { sessionId, status: "running" },
		})
	}

	private emitInfo(text: string, sessionId?: string): void {
		const targetSessionId = this.getTargetSessionId()
		if (sessionId && targetSessionId !== sessionId) {
			Logger.warn(`[SdkController] compactTask: skipped info for inactive session ${sessionId}`)
			return
		}
		const infoMessage: ClineMessage = {
			ts: Date.now(),
			type: "say",
			say: "info",
			text,
			partial: false,
		}
		this.options.messages.appendAndEmit([infoMessage], {
			type: "status",
			payload: { sessionId: sessionId ?? targetSessionId ?? "", status: "running" },
		})
	}

	/**
	 * The session a compaction row belongs to: the active session if one exists,
	 * otherwise the displayed task. The fallback lets the displayed-task path's
	 * terminal failure message land after its transient session has been ended.
	 */
	private getTargetSessionId(): string | undefined {
		return this.options.sessions.getActiveSession()?.sessionId ?? this.options.getDisplayedTaskId()
	}
}
