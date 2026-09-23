import type { BatchChatSnapshot, BatchField, BatchPhase, BatchRow } from "@shared/loomloom"
import { describe, expect, it } from "vitest"
import { getBatchGuidance, isBatchQuoteCurrent } from "./batch-guidance"

const now = 1_000_000
const source: BatchField = { key: "source", label: "原文", value_type: "string", required: true }
const row = (values: BatchRow["values"] = {}, attachments: BatchRow["attachments"] = []): BatchRow => ({
	id: "row",
	values,
	attachments,
})

function snapshot(overrides: Partial<BatchChatSnapshot> = {}, fields: BatchField[] = [source]): BatchChatSnapshot {
	return {
		version: 1,
		id: "batch",
		taskId: "task",
		enabled: true,
		revision: 2,
		phase: "collecting",
		listing: {
			id: "listing",
			name: "文本扩写助手",
			versionId: "v1",
			availability: "available",
			description: "扩写原文",
			schema: { schema_version: "loom_market_public_input_schema_v1", fields },
		},
		rows: [row()],
		events: [],
		...overrides,
	}
}

function quoted(): BatchChatSnapshot {
	return snapshot({
		phase: "quoted",
		rows: [row({ source: "待扩写原文" })],
		quote: {
			id: "quote",
			revision: 2,
			hash: "hash",
			versionId: "v1",
			payable: { amount: "4.00", currency: "CNY" },
			taskCount: 1,
			at: now,
			valid: true,
		},
	})
}

describe("getBatchGuidance", () => {
	it("does not treat newly added rows as completed input", () => {
		const guidance = getBatchGuidance(snapshot({ rows: [row(), row(), row()] }), now)
		expect(guidance.message).toBe("当前有 3 行任务，输入还没有填写。")
		expect(guidance.nextStep).toContain("第 1 条缺少「原文」")
	})

	it("points to the actual missing row when earlier rows are filled", () => {
		const guidance = getBatchGuidance(snapshot({ rows: [row({ source: "内容" }), row({ source: "  " })] }), now)
		expect(guidance.message).toContain("还有内容需要补全或调整")
		expect(guidance.nextStep).toContain("第 2 条缺少「原文」")
	})

	it("reports validated inputs separately from content review", () => {
		const guidance = getBatchGuidance(snapshot({ rows: [row({ source: "甲" }), row({ source: "乙" })] }), now)
		expect(guidance.message).toContain("2 行输入均通过了必填项和格式检查")
		expect(guidance.nextStep).toContain("点击「检查输入」")
	})

	it("treats unattached references as material still needing preparation", () => {
		const guidance = getBatchGuidance(
			snapshot({ rows: [row({}, [{ id: "file", name: "参考.md", path: "D:/参考.md" }])] }),
			now,
		)
		expect(guidance.message).toContain("参考文件已添加")
		expect(guidance.nextStep).toContain("缺少「原文」")
	})

	it("requires asset values to match actual field attachments", () => {
		const asset: BatchField = { key: "asset", label: "参考图", value_type: "asset_ref", required: true }
		const session = snapshot({ rows: [row({ asset: "asset-1" })] }, [asset])
		expect(getBatchGuidance(session, now).nextStep).toContain("需要通过附件按钮上传")
		session.rows[0].attachments.push({
			id: "file",
			name: "图.png",
			path: "D:/图.png",
			field: "asset",
			inputAssetId: "asset-1",
		})
		expect(getBatchGuidance(session, now).title).toBe("检查输入")
	})

	it("does not treat metadata defaults as already filled inputs", () => {
		const guidance = getBatchGuidance(snapshot({}, [{ ...source, default_value: "默认原文" }]), now)
		expect(guidance.message).toContain("输入还没有填写")
		expect(guidance.nextStep).toContain("缺少「原文」")
	})

	it("distinguishes all-optional blank rows from prepared material", () => {
		const guidance = getBatchGuidance(snapshot({ rows: [row(), row()] }, [{ ...source, required: false }]), now)
		expect(guidance.message).toContain("尚未填写输入")
		expect(guidance.nextStep).toContain("确认使用默认设置")
	})

	it("does not count empty optional rows as filled when another row has input", () => {
		const guidance = getBatchGuidance(
			snapshot({ rows: [row({ source: "内容" }), row()] }, [{ ...source, required: false }]),
			now,
		)
		expect(guidance.message).toBe("当前输入已通过格式检查，未填写的可选项将使用工作流默认设置。")
	})

	it("does not mistake optional reference attachments for filled input fields", () => {
		const guidance = getBatchGuidance(
			snapshot({ rows: [row({}, [{ id: "file", name: "参考.md", path: "D:/参考.md" }])] }, [
				{ ...source, required: false },
			]),
			now,
		)
		expect(guidance.message).toContain("输入字段尚未填写")
		expect(guidance.nextStep).toContain("确认使用默认设置")
	})

	it("handles workflows with no public fields without claiming material was filled", () => {
		const guidance = getBatchGuidance(snapshot({}, []), now)
		expect(guidance.message).toContain("没有公开的输入字段")
		expect(guidance.nextStep).toContain("可以继续增删行")
	})

	it("asks to load missing schema and add rows when none exist", () => {
		expect(getBatchGuidance(snapshot({ listing: undefined }), now).message).toContain("还没有加载")
		expect(getBatchGuidance(snapshot({ rows: [] }), now).message).toContain("还没有任务行")
	})

	it("accepts required false and zero values", () => {
		const fields: BatchField[] = [
			{ key: "enabled", value_type: "boolean", required: true },
			{ key: "count", value_type: "integer", required: true },
		]
		expect(getBatchGuidance(snapshot({ rows: [row({ enabled: false, count: 0 })] }, fields), now).title).toBe("检查输入")
	})

	it("uses canonical validation for malformed nonempty input", () => {
		const fields: BatchField[] = [{ key: "count", label: "数量", value_type: "integer", required: true }]
		const guidance = getBatchGuidance(snapshot({ rows: [row({ count: "abc" })] }, fields), now)
		expect(guidance.nextStep).toContain("需要有效数字")
		expect(guidance.title).toBe("补充输入")
	})

	it("keeps guidance concise without echoing submitted field values", () => {
		const secretInput = "用户原文".repeat(1_000)
		const guidance = getBatchGuidance(snapshot({ rows: [row({ source: secretInput }), row()] }), now)
		expect(JSON.stringify(guidance)).not.toContain(secretInput)
		expect(guidance.nextStep.length).toBeLessThan(200)
	})

	it.each<BatchPhase>([
		"selecting",
		"quantity",
		"collecting",
		"reviewing",
		"quoting",
		"quoted",
		"submitting",
		"execution-unknown",
		"running",
		"completed",
		"partial-failure",
		"failed",
	])("provides a specific next step for phase %s", (phase) => {
		const guidance = getBatchGuidance(snapshot({ phase }), now)
		expect(guidance.title).toBeTruthy()
		expect(guidance.message).toBeTruthy()
		expect(guidance.nextStep).toBeTruthy()
	})

	it("requires user confirmation for a current quote", () => {
		const guidance = getBatchGuidance(quoted(), now)
		expect(guidance.title).toBe("确认预算")
		expect(guidance.nextStep).toContain("由你点击「确认并运行」")
	})

	it("matches the backend's ten-minute expiry boundary", () => {
		expect(getBatchGuidance(quoted(), now + 10 * 60_000).title).toBe("确认预算")
		expect(getBatchGuidance(quoted(), now + 10 * 60_000 + 1).title).toBe("重新获取预算")
	})

	it("exposes the same current-quote check for confirmation controls", () => {
		const session = quoted()
		expect(isBatchQuoteCurrent(session, now)).toBe(true)
		expect(isBatchQuoteCurrent(session, now + 10 * 60_000 + 1)).toBe(false)
		session.revision++
		expect(isBatchQuoteCurrent(session, now)).toBe(false)
		expect(isBatchQuoteCurrent(snapshot(), now)).toBe(false)
	})

	it.each([
		{ valid: false },
		{ revision: 1 },
		{ versionId: "old-version" },
		{ taskCount: 2 },
		{ at: Number.NaN },
	])("rejects an invalid or stale quote snapshot %j", (quotePatch) => {
		const session = quoted()
		Object.assign(session.quote!, quotePatch)
		expect(getBatchGuidance(session, now).title).toBe("重新获取预算")
	})

	it("requires another quote if the quote is missing", () => {
		expect(getBatchGuidance(snapshot({ phase: "quoted" }), now).title).toBe("重新获取预算")
	})

	it("keeps uncertain submissions in recovery rather than asking to run again", () => {
		const guidance = getBatchGuidance(snapshot({ phase: "execution-unknown" }), now)
		expect(guidance.message).toContain("暂时无法确认")
		expect(guidance.nextStep).toContain("运行 ID 并关联")
		expect(guidance.nextStep).toContain("请勿重复提交")
	})

	it("uses only actual progress counts", () => {
		const session = snapshot({
			phase: "running",
			progress: { status: "running", total: 5, completed: 2, failed: 1, cancelled: 1 },
		})
		expect(getBatchGuidance(session, now).message).toContain("成功 2/5 条、失败 1 条、取消 1 条")
		expect(getBatchGuidance(snapshot({ phase: "running" }), now).message).toContain("正在同步云端运行进度")
	})

	it("shows a continuation step when Batch mode is disabled", () => {
		expect(getBatchGuidance(snapshot({ enabled: false }), now).nextStep).toContain("切换到 Batch")
	})

	it("does not mutate the snapshot", () => {
		const session = quoted()
		const before = structuredClone(session)
		getBatchGuidance(session, now + 10 * 60_000 + 1)
		expect(session).toEqual(before)
	})
})
