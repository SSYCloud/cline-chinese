import { describe, expect, it } from "bun:test"
import type { BatchSession } from "@shared/loomloom"
import { projectBatchContext } from "./batch-agent-bridge"

describe("Batch Agent sparse worksheet context", () => {
	it("reports real task count while preserving visual row positions", () => {
		const session: BatchSession = {
			version: 1,
			id: "batch",
			taskId: "cline-task",
			enabled: true,
			revision: 2,
			phase: "collecting",
			listing: {
				id: "listing",
				name: "测试工作流",
				description: "",
				versionId: "v1",
				availability: "available",
				schema: {
					schema_version: "loom_market_public_input_schema_v1",
					fields: [{ key: "text", label: "内容", value_type: "string", required: true }],
				},
			},
			rows: [
				{ id: "seed", sheetRowNumber: 2, origin: "implicit", values: {}, attachments: [] },
				{ id: "far", sheetRowNumber: 20, origin: "implicit", values: { text: "第 20 行" }, attachments: [] },
			],
			results: [],
			artifacts: [],
			events: [],
		}
		const context = projectBatchContext(session, [])
		expect(context.quantity).toBe(1)
		expect(context.rows).toMatchObject([
			{ id: "seed", sheetRowNumber: 2, billable: false },
			{ id: "far", sheetRowNumber: 20, billable: true },
		])
	})
})
