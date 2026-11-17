import { AskResponseRequest } from "@shared/proto/cline/task"
import { describe, expect, it, vi } from "vitest"
import type { Controller } from ".."
import { askResponse } from "./askResponse"

function makeController(input: { hasTask: boolean; answered?: boolean }) {
	const handleWebviewAskResponse = vi.fn(async () => undefined)
	const answerDetachedAsk = vi.fn(() => input.answered ?? true)
	const controller = {
		task: input.hasTask ? { handleWebviewAskResponse } : undefined,
		answerDetachedAsk,
	}
	return { controller: controller as unknown as Controller, handleWebviewAskResponse, answerDetachedAsk }
}

describe("askResponse without a task", () => {
	it("hands a typed answer to the question waiting for it", async () => {
		const { controller, answerDetachedAsk, handleWebviewAskResponse } = makeController({ hasTask: false })

		await askResponse(
			controller,
			AskResponseRequest.create({ responseType: "messageResponse", text: "删除: 请保留", images: [] }),
		)

		expect(answerDetachedAsk).toHaveBeenCalledWith("删除: 请保留", [], [])
		expect(handleWebviewAskResponse).not.toHaveBeenCalled()
	})

	it("does not forward button-style responses that carry no answer text", async () => {
		const { controller, answerDetachedAsk } = makeController({ hasTask: false })

		await askResponse(controller, AskResponseRequest.create({ responseType: "yesButtonClicked" }))

		expect(answerDetachedAsk).not.toHaveBeenCalled()
	})

	it("routes to the displayed task when one is open", async () => {
		const { controller, answerDetachedAsk, handleWebviewAskResponse } = makeController({ hasTask: true })

		await askResponse(controller, AskResponseRequest.create({ responseType: "messageResponse", text: "取消" }))

		expect(handleWebviewAskResponse).toHaveBeenCalledWith("messageResponse", "取消", [], [])
		expect(answerDetachedAsk).not.toHaveBeenCalled()
	})
})
