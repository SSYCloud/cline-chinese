import type { ClineMessage } from "@shared/ExtensionMessage"
import { describe, expect, it } from "vitest"
import { placeBatchEvents } from "./batch-timeline"

describe("one conversation timeline", () => {
	it("interleaves UI and Agent state changes without creating another transcript or changing Cline row indices", () => {
		const messages: ClineMessage[] = [
			{ ts: 10, type: "say", say: "text", text: "你好" },
			{ ts: 30, type: "say", say: "user_feedback", text: "推荐一个skillbot吧" },
			{ ts: 50, type: "say", say: "text", text: "推荐结果" },
		]
		const events = [
			{ id: "enter", at: 20, text: "已进入 Batch" },
			{ id: "select", at: 60, text: "已选择" },
			{ id: "early", at: 5, text: "准备" },
		]
		const placed = placeBatchEvents(messages, events)
		expect(placed.before.map((e) => e.id)).toEqual(["early"])
		expect(placed.after.get(0)?.map((e) => e.id)).toEqual(["enter"])
		expect(placed.after.get(2)?.map((e) => e.id)).toEqual(["select"])
		expect(messages.map((m) => m.ts)).toEqual([10, 30, 50])
	})
	it("does not anchor state changes to a synthetic Thinking row", () => {
		const placed = placeBatchEvents(
			[
				{ ts: 10, type: "say", say: "text" },
				{ ts: Number.MIN_SAFE_INTEGER, type: "say", say: "reasoning" },
			],
			[{ id: "edited", at: 20, text: "已修改" }],
		)
		expect(placed.after.has(0)).toBe(true)
		expect(placed.after.has(1)).toBe(false)
	})
})
