import type { BatchWorksheetView } from "@shared/loomloom"
import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { z } from "zod"
import { getRequestRegistry, type StreamingResponseHandler } from "../grpc-handler"
import type { Controller } from "../index"
export async function subscribeBatchTable(
	controller: Controller,
	request: StringRequest,
	response: StreamingResponseHandler<StringResponse>,
	requestId?: string,
): Promise<void> {
	const { taskId } = z.object({ taskId: z.string().min(1).max(200) }).parse(JSON.parse(request.value))
	await controller.batch.ready
	let closed = false
	let sequence = 0
	let delivery = Promise.resolve()
	let sending = false
	let hasFull = false
	let pendingFull: Awaited<ReturnType<typeof controller.batch.snapshot>>
	let pendingView: BatchWorksheetView | undefined
	let pendingCreator: { draft: Record<string, unknown>; updatedAt: number } | undefined
	// A slow editor webview must not accumulate every intermediate poll/selection.
	// Keep the newest full state and the newest lightweight view change only.
	const flush = () => {
		if (sending || closed) return
		sending = true
		delivery = Promise.resolve()
			.then(async () => {
				while (!closed && (hasFull || pendingView || pendingCreator)) {
					let value: string
					if (hasFull) {
						const session = pendingFull
						hasFull = false
						pendingFull = undefined
						value = JSON.stringify({ session: session ?? null, editable: controller.task?.taskId === taskId })
					} else if (pendingCreator) {
						const creator = pendingCreator
						pendingCreator = undefined
						value = JSON.stringify({ kind: "creator", ...creator, editable: controller.task?.taskId === taskId })
					} else {
						const worksheet = pendingView
						pendingView = undefined
						value = JSON.stringify({ kind: "view", worksheet, editable: controller.task?.taskId === taskId })
					}
					await response(StringResponse.create({ value }), false, ++sequence)
				}
			})
			.catch(() => cleanup())
			.finally(() => {
				sending = false
				if (!closed && (hasFull || pendingView || pendingCreator)) flush()
			})
	}
	const publish = (session: Awaited<ReturnType<typeof controller.batch.snapshot>>) => {
		pendingFull = session
		hasFull = true
		pendingView = undefined
		flush()
	}
	let fullUpdates = 0
	const unsubscribe = controller.batch.subscribe(taskId, (session) => {
		fullUpdates++
		publish(session)
	})
	const unsubscribeView = controller.batch.subscribeWorksheetView(taskId, (view) => {
		if (hasFull && pendingFull) pendingFull.worksheet = view
		else pendingView = view
		flush()
	})
	const unsubscribeCreator =
		controller.creator?.subscribeDraft(taskId, (event) => {
			pendingCreator = event
			flush()
		}) ?? (() => {})
	const cleanup = () => {
		closed = true
		unsubscribe()
		unsubscribeView()
		unsubscribeCreator()
	}
	if (requestId) getRequestRegistry().registerRequest(requestId, cleanup, { type: "batch_table", taskId }, response)
	const initial = await controller.batch.snapshot(taskId)
	if (!fullUpdates) publish(initial)
	await delivery
}
