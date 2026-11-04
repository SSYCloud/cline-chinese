import type { CoreCompactionContext, CoreCompactionResult } from "@cline/core"
import type { ContentBlock, MessageWithMetadata, ToolResultContent } from "@cline/shared"
import { DEFAULT_TYPESAFE_MODEL } from "@shared/typesafe-models"
import {
	type CallAction,
	collectToolCalls,
	compact,
	DEFAULT_TEST_DELETE_THRESHOLD,
	goalFromMessages,
	JevClient,
	type Message,
	pruneTests,
	resolveOptions,
	truncatedResultText,
} from "./library"
import { createTestFileAccess } from "./test-file-access"

export interface TypesafePreCompactOptions {
	apiKey: string
	model?: string
	testDeleteThreshold?: number
	workspaceRoot?: string
	fetch?: typeof fetch
	log?: (message: string) => void
}

function textOf(message: MessageWithMetadata): string {
	if (typeof message.content === "string") return message.content
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n")
}

function resultText(content: ToolResultContent["content"]): string {
	if (typeof content === "string") return content
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n")
}

function toLibraryMessage(message: MessageWithMetadata): Message {
	const blocks = Array.isArray(message.content) ? message.content : []
	const toolUses: Message["toolUses"] = []
	const toolResults: NonNullable<Message["toolResults"]> = []
	for (const block of blocks) {
		if (block.type === "tool_use") {
			toolUses.push({
				tool_use_id: block.id,
				tool: block.name,
				input: block.input,
			})
		} else if (block.type === "tool_result") {
			toolResults.push({
				tool_use_id: block.tool_use_id,
				text: resultText(block.content),
				isError: block.is_error ?? false,
			})
		}
	}
	const converted: Message = {
		role: message.role,
		text: textOf(message),
		toolUses,
	}
	if (toolResults.length > 0) converted.toolResults = toolResults
	return converted
}

function isEmptyContent(content: ContentBlock[]): boolean {
	return content.length === 0 || content.every((block) => block.type === "text" && block.text.trim().length === 0)
}

function dropResultBlock(block: ToolResultContent, headChars: number): ContentBlock {
	if (typeof block.content === "string") {
		const text = truncatedResultText(block.content, block.is_error ?? false, headChars)
		return text === block.content ? block : { ...block, content: text }
	}
	return {
		...block,
		content: truncatedResultText(resultText(block.content), block.is_error ?? false, headChars),
	}
}

function applyActions(
	messages: readonly MessageWithMetadata[],
	actions: ReadonlyMap<string, CallAction>,
	headChars: number,
): { messages: MessageWithMetadata[]; changed: boolean } {
	if (actions.size === 0) return { messages: [...messages], changed: false }
	const kept: MessageWithMetadata[] = []
	let anyChanged = false
	for (const message of messages) {
		if (!Array.isArray(message.content)) {
			kept.push(message)
			continue
		}
		let changed = false
		const content: ContentBlock[] = []
		for (const block of message.content) {
			if (block.type === "tool_use") {
				if (actions.get(block.id) === "drop_call") {
					changed = true
					continue
				}
			} else if (block.type === "tool_result") {
				const action = actions.get(block.tool_use_id)
				if (action === "drop_call") {
					changed = true
					continue
				}
				if (action === "drop_result") {
					const truncated = dropResultBlock(block, headChars)
					if (truncated !== block) {
						changed = true
						content.push(truncated)
						continue
					}
				}
			}
			content.push(block)
		}
		if (!changed) {
			kept.push(message)
			continue
		}
		anyChanged = true
		if (isEmptyContent(content)) continue
		kept.push({ ...message, content })
	}
	return { messages: kept, changed: anyChanged }
}

function decisionActions(
	decisions: Awaited<ReturnType<typeof compact>>["decisions"],
	messages: readonly Message[],
	preserveRecentMessages: number,
): Map<string, CallAction> {
	const byId = new Map(collectToolCalls(messages, preserveRecentMessages).map((call) => [call.id, call.tool_use_id]))
	const actions = new Map<string, CallAction>()
	for (const decision of decisions) {
		const toolUseId = byId.get(decision.id)
		if (toolUseId && decision.action !== "keep") {
			actions.set(toolUseId, decision.action)
		}
	}
	return actions
}

export function createTypesafePreCompact(
	options: TypesafePreCompactOptions,
): ((context: CoreCompactionContext) => Promise<CoreCompactionResult | undefined>) | undefined {
	const apiKey = options.apiKey.trim()
	if (!apiKey) return undefined
	const log = options.log ?? (() => {})
	const model = options.model?.trim() || DEFAULT_TYPESAFE_MODEL
	const compactOptions = resolveOptions()
	const deleteThreshold = options.testDeleteThreshold ?? DEFAULT_TEST_DELETE_THRESHOLD
	const workspaceRoot = options.workspaceRoot

	return async (context) => {
		const original = context.messages
		const libraryMessages = original.map(toLibraryMessage)
		const asker = new JevClient({
			apiKey,
			model,
			fetch: options.fetch,
			signal: context.abortSignal,
		})
		let messages: MessageWithMetadata[] = original
		let changed = false
		try {
			const result = await compact(libraryMessages, asker, compactOptions)
			const actions = decisionActions(result.decisions, libraryMessages, compactOptions.preserveRecentMessages)
			const applied = applyActions(original, actions, compactOptions.truncateHeadChars)
			messages = applied.messages
			changed = applied.changed
		} catch (error) {
			if (context.abortSignal?.aborted) throw error
			log(`typesafe compaction skipped: ${error instanceof Error ? error.message : String(error)}`)
		}

		if (workspaceRoot && deleteThreshold > 0) {
			try {
				const pruned = await pruneTests(createTestFileAccess(workspaceRoot), asker, {
					goal: goalFromMessages(libraryMessages),
					deleteThreshold,
				})
				if (pruned.deleted.length > 0) {
					log(`typesafe test pruning removed ${pruned.deleted.length}/${pruned.tests} tests`)
				}
			} catch (error) {
				if (context.abortSignal?.aborted) throw error
				log(`typesafe test pruning skipped: ${error instanceof Error ? error.message : String(error)}`)
			}
		}

		return changed ? { messages } : undefined
	}
}
