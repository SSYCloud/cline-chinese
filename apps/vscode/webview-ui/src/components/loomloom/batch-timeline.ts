import type { ClineMessage } from "@shared/ExtensionMessage"
import type { BatchEvent } from "@shared/loomloom"

/** Keep Cline's virtual row indices stable; interleave domain events within their timestamp anchors. */
export function placeBatchEvents(messages: (ClineMessage | ClineMessage[])[], events: BatchEvent[]) {
	const before: BatchEvent[] = []
	const after = new Map<number, BatchEvent[]>()
	for (const event of [...events].sort((a, b) => a.at - b.at)) {
		let anchor = -1
		for (let index = 0; index < messages.length; index++) {
			const row = messages[index]
			const ts = Array.isArray(row) ? row[0]?.ts : row.ts
			if (ts !== undefined && ts !== Number.MIN_SAFE_INTEGER && ts <= event.at) anchor = index
		}
		if (anchor < 0) before.push(event)
		else after.set(anchor, [...(after.get(anchor) || []), event])
	}
	return { before, after }
}
