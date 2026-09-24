import type { BatchCommand } from "@shared/loomloom"
import { z } from "zod"

const revision = z.number().int().nonnegative()
const id = z.string().min(1).max(200)
const command = z.discriminatedUnion("action", [
	z.object({ action: z.literal("mode"), mode: z.enum(["plan", "act", "batch"]) }),
	z.object({ action: z.literal("select"), listingId: id, revision: revision.optional() }),
	z.object({ action: z.literal("quantity"), count: z.number().int().min(1).max(100), revision }),
	z.object({ action: z.literal("addRows"), count: z.number().int().min(1).max(100), revision }),
	z.object({ action: z.literal("removeRows"), rowIds: z.array(id).min(1).max(100), revision }),
	z.object({
		action: z.literal("patch"),
		revision,
		rows: z.array(z.object({ id, values: z.record(z.string(), z.unknown()) })).max(100),
	}),
	z.object({ action: z.literal("removeAttachment"), revision, rowId: id, attachmentId: id }),
	z.object({ action: z.literal("review"), revision }),
	z.object({ action: z.literal("revise"), revision }),
	z.object({ action: z.literal("quote"), revision }),
	z.object({ action: z.literal("execute"), revision, quoteId: id }),
	z.object({ action: z.literal("refreshRun") }),
	z.object({ action: z.literal("recoverRun"), runId: id }),
	z.object({ action: z.literal("newBatch"), revision: revision.optional(), keepListing: z.boolean().optional() }),
])
export function parseBatchCommand(value: string): { taskId?: string; command: BatchCommand } {
	if (value.length > 1_000_000) throw new Error("批量输入过大，请缩小范围。")
	return z.object({ taskId: id.optional(), command }).parse(JSON.parse(value)) as { taskId?: string; command: BatchCommand }
}
