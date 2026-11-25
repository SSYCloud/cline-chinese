import { type AgentExtensionCommand, listClaudePluginFunctionCommands } from "@cline/core"
import type { ClineMessage } from "@shared/ExtensionMessage"
import type { StateManager } from "@/core/storage/StateManager"
import { buildJevPluginOptions, JEV_COMPACTION_PLUGIN_NAME, resolveTypesafeConfig } from "@/services/typesafe-compaction/config"
import { Logger } from "@/shared/services/Logger"
import type { SdkMessageCoordinator } from "./sdk-message-coordinator"
import type { SdkSessionLifecycle } from "./sdk-session-lifecycle"

export interface SdkPluginCommandCoordinatorOptions {
	stateManager: StateManager
	sessions: SdkSessionLifecycle
	messages: SdkMessageCoordinator
	getDisplayedTaskId: () => string | undefined
	getWorkspaceRoot: () => Promise<string>
	postStateToWebview: () => Promise<void>
}

/**
 * Runs slash commands that Claude Code plugins register from function-hook
 * modules (for example fast-jev-compaction's `/prune-tests`). They execute
 * plugin code and report back in the chat; they are never sent to the model.
 */
export class SdkPluginCommandCoordinator {
	private readonly inFlight = new Set<string>()

	constructor(private readonly options: SdkPluginCommandCoordinatorOptions) {}

	async run(input: string): Promise<void> {
		const match = input.trim().match(/^\/?(\S+)\s*([\s\S]*)$/)
		if (!match) {
			return
		}
		const [, name, args] = match
		if (this.inFlight.has(name)) {
			return
		}
		this.inFlight.add(name)
		try {
			const command = await this.findCommand(name)
			if (!command?.handler) {
				this.emitInfo(`未找到插件命令 /${name}。请确认插件已安装并重启会话。`)
				return
			}
			this.emitInfo(`正在执行 /${name}…`)
			await this.options.postStateToWebview()
			const result = await command.handler(args.trim())
			const reply = typeof result === "string" ? result : result?.reply
			this.emitInfo(reply?.trim() || `/${name} 已完成。`)
		} catch (error) {
			Logger.error(`[SdkController] plugin command /${name} failed:`, error)
			this.emitInfo(`/${name} 失败：${error instanceof Error ? error.message : String(error)}`)
		} finally {
			this.inFlight.delete(name)
			await this.options.postStateToWebview()
		}
	}

	private async findCommand(name: string): Promise<AgentExtensionCommand | undefined> {
		const cwd = await this.options.getWorkspaceRoot()
		const commands = await listClaudePluginFunctionCommands({
			cwd,
			pluginOptions: {
				[JEV_COMPACTION_PLUGIN_NAME]: buildJevPluginOptions(resolveTypesafeConfig(this.options.stateManager)),
			},
			logger: { log: (message: string) => Logger.log(message) } as never,
		})
		return commands.find((command) => command.name.toLowerCase() === name.toLowerCase())
	}

	private emitInfo(text: string): void {
		const sessionId = this.options.sessions.getActiveSession()?.sessionId ?? this.options.getDisplayedTaskId()
		const message: ClineMessage = { ts: Date.now(), type: "say", say: "info", text, partial: false }
		this.options.messages.appendAndEmit([message], {
			type: "status",
			payload: { sessionId: sessionId ?? "", status: "running" },
		})
	}
}
