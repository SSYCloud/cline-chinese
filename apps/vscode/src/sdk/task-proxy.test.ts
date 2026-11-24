import { describe, expect, it, vi } from "vitest"
import { createTaskProxy, MessageStateHandler } from "./task-proxy"

describe("MessageStateHandler", () => {
	it("should start with empty messages", () => {
		const handler = new MessageStateHandler()
		expect(handler.getClineMessages()).toEqual([])
	})

	it("should add and retrieve messages", () => {
		const handler = new MessageStateHandler()
		const messages = [
			{ ts: 1, type: "say" as const, say: "text" as const, text: "hello", partial: false },
			{ ts: 2, type: "say" as const, say: "tool" as const, text: "tool call", partial: false },
		]
		handler.addMessages(messages)
		expect(handler.getClineMessages()).toHaveLength(2)
		expect(handler.getClineMessages()[0].text).toBe("hello")
		expect(handler.getClineMessages()[1].text).toBe("tool call")
	})

	it("should return a copy of messages", () => {
		const handler = new MessageStateHandler()
		handler.addMessages([{ ts: 1, type: "say", say: "text", text: "hello", partial: false }])
		const copy = handler.getClineMessages()
		copy.push({ ts: 2, type: "say", say: "text", text: "extra", partial: false })
		expect(handler.getClineMessages()).toHaveLength(1)
	})

	it("should clear messages", () => {
		const handler = new MessageStateHandler()
		handler.addMessages([{ ts: 1, type: "say", say: "text", text: "hello", partial: false }])
		handler.clear()
		expect(handler.getClineMessages()).toEqual([])
	})
})

describe("createTaskProxy", () => {
	it("should delegate unknown askResponse types to onAskResponse", async () => {
		const onAskResponse = vi.fn().mockResolvedValue(undefined)
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		// biome-ignore lint/suspicious/noExplicitAny: testing unknown ask response type
		await proxy.handleWebviewAskResponse("command" as any, "ls -la", [], [])

		expect(onAskResponse).toHaveBeenCalledWith("ls -la", [], [])
	})

	it("should store askResponse in taskState", async () => {
		const onAskResponse = vi.fn().mockResolvedValue(undefined)
		const onCancelTask = vi.fn()
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		await proxy.handleWebviewAskResponse("messageResponse", "hello")

		expect(proxy.taskState.askResponse).toBe("messageResponse")
	})

	it("should delegate abortTask to onCancelTask", async () => {
		const onAskResponse = vi.fn()
		const onCancelTask = vi.fn().mockResolvedValue(undefined)
		const proxy = createTaskProxy("session-123", onAskResponse, onCancelTask)

		await proxy.abortTask()

		expect(onCancelTask).toHaveBeenCalled()
	})
})
