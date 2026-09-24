import { afterEach, describe, expect, it, mock } from "bun:test"
import { type BatchField, canonicalRows, type SkillBot } from "@shared/loomloom"
import { resolveBatchModelField } from "@shared/loomloom-models"
import { buildSheet, rangePatches } from "@shared/loomloom-sheet"
import { batchModels } from "@/core/controller/loomLoom/batchModels"
import { BatchService } from "./batch-service"
import type { BatchApi } from "./client"
import { BatchTableService } from "./table-operations"

// Shape returned by the public ecom-details-image Pro listing, without model_override.
const publicTextModel = {
	key: "text_model",
	label: "文本模型",
	description: "留空使用平台当前默认文本模型。",
	presentation: {},
	source_kind: "user_input",
	value_type: "string",
}

const services: BatchService[] = []
afterEach(() => {
	for (const service of services.splice(0)) service.dispose()
})

async function setup(field: BatchField = publicTextModel) {
	const listing: SkillBot = {
		id: "listing",
		name: "电商详情",
		description: "",
		versionId: "v1",
		availability: "available",
		schema: { schema_version: "loom_market_public_input_schema_v1", fields: [structuredClone(field)] },
	}
	const models = mock(async (stepType: string) =>
		stepType === "text-generate"
			? [
					{ id: "text-a", name: "文本 A" },
					{ id: "text-b", name: "文本 B" },
				]
			: [{ id: "image-a", name: "图片 A" }],
	)
	const api: BatchApi = {
		detail: async () => structuredClone(listing),
		models,
		quote: mock(async () => ({})),
		execute: mock(async () => ({})),
		run: async () => ({ status: "running", total: 1, completed: 0, failed: 0, rows: [], artifacts: [] }),
	}
	const service = new BatchService({ loadAll: async () => [], save: async () => {} }, api, () => {}, 60_000)
	services.push(service)
	await service.setEnabled("task", true)
	const selected = await service.command("task", { action: "select", listingId: listing.id })
	await service.command("task", { action: "quantity", count: 1, revision: selected.revision })
	const table = new BatchTableService(
		service,
		{
			models,
			open: async () => {},
			action: async () => {},
			attach: async () => {},
		},
		() => "task",
	)
	const snapshot = async () => (await service.snapshot("task"))!
	const controller = { task: { taskId: "task" }, batch: service, loomLoom: { models } } as unknown as Parameters<
		typeof batchModels
	>[0]
	return { service, table, snapshot, models, api, controller }
}

describe("public Batch model fields", () => {
	it("resolves the real text_model public field without altering its schema", () => {
		const original = structuredClone(publicTextModel)
		expect(resolveBatchModelField(publicTextModel)).toEqual({ isModel: true, stepType: "text-generate", allowOverride: true })
		expect(publicTextModel).toEqual(original)
	})

	for (const [key, label, stepType] of [
		["text_model", "文本模型", "text-generate"],
		["image_model", "图片模型", "image-generate"],
		["custom", "图像模型", "image-generate"],
		["video_model", "视频模型", "video-generate"],
		["audio_model", "音频模型", "audio-generate"],
		["audio_transcribe_model", "音频转写模型", "audio-transcribe"],
		["model3d", "3D模型", "model3d-generate"],
	]) {
		it(`maps ${key}/${label} to the documented ${stepType} catalog`, () => {
			expect(resolveBatchModelField({ key, label, value_type: "string" })).toMatchObject({ stepType, allowOverride: true })
		})
	}

	it("keeps explicit metadata authoritative and refuses ambiguous or invalid types", () => {
		expect(
			resolveBatchModelField({
				...publicTextModel,
				model_override: {
					step_type: "image-generate",
					allow_override: false,
					default_model_id: "recommended-by-schema",
				},
			}),
		).toEqual({ isModel: true, stepType: "image-generate", allowOverride: false, defaultModelId: "recommended-by-schema" })
		for (const field of [
			{ key: "model", value_type: "string" },
			{ ...publicTextModel, label: "图像模型" },
			{ ...publicTextModel, model_override: { step_type: "unknown" } },
		])
			expect(resolveBatchModelField(field)).toMatchObject({ isModel: true, stepType: undefined, allowOverride: false })
		expect(resolveBatchModelField({ key: "constructor", value_type: "string" })).toMatchObject({
			isModel: false,
			allowOverride: false,
		})
	})

	it("RPC and Agent model lookup expose the same live text catalog and save a supported selection", async () => {
		const f = await setup()
		const rpc = await batchModels(f.controller, { value: JSON.stringify({ taskId: "task", field: "text_model" }) })
		const agent = await f.table.execute("task", { action: "models", range: "C2" }, "agent")
		expect(JSON.parse(rpc.value)).toEqual([
			{ id: "text-a", name: "文本 A" },
			{ id: "text-b", name: "文本 B" },
		])
		expect(agent).toMatchObject({ recommendedDefault: true, items: JSON.parse(rpc.value) })
		expect(f.models.mock.calls.every(([step]) => step === "text-generate")).toBe(true)
		let session = await f.snapshot()
		await f.table.execute("task", { action: "write", range: "C2", revision: session.revision, values: [["text-a"]] }, "agent")
		session = await f.snapshot()
		expect(session.rows[0].values.text_model).toBe("text-a")
		expect(session.listing?.schema?.fields[0]).toEqual(publicTextModel)
		await expect(
			f.service.command(
				"task",
				{
					action: "patch",
					revision: session.revision,
					rows: [{ id: session.rows[0].id, values: { text_model: "image-a" } }],
				},
				"user",
			),
		).rejects.toThrow("支持模型列表")
		expect((await f.snapshot()).rows[0].values.text_model).toBe("text-a")
		expect(f.api.quote).not.toHaveBeenCalled()
		expect(f.api.execute).not.toHaveBeenCalled()
	})

	it("filters enum constraints from both catalogs and enforces them on every write path", async () => {
		const f = await setup({ ...publicTextModel, enum_values: ["text-b"] })
		const rpc = await batchModels(f.controller, { value: JSON.stringify({ taskId: "task", field: "text_model" }) })
		expect(JSON.parse(rpc.value)).toEqual([{ id: "text-b", name: "文本 B" }])
		expect(await f.table.execute("task", { action: "models", range: "C2" }, "agent")).toMatchObject({
			items: JSON.parse(rpc.value),
		})
		const session = await f.snapshot()
		expect(() => rangePatches(buildSheet(session), "C2", [["text-a"]])).toThrow("可选项")
		await expect(
			f.service.command("task", {
				action: "patch",
				revision: session.revision,
				rows: [{ id: session.rows[0].id, values: { text_model: "text-a" } }],
			}),
		).rejects.toThrow()
		await f.table.execute("task", { action: "write", range: "C2", revision: session.revision, values: [["text-b"]] })
		expect((await f.snapshot()).rows[0].values.text_model).toBe("text-b")
	})

	for (const field of [
		{ ...publicTextModel, model_override: { step_type: "text-generate", allow_override: false } },
		{ key: "model", label: "模型", value_type: "string" },
	]) {
		it(`keeps ${field.key} at default when overrides are forbidden or modality is unknown`, async () => {
			const f = await setup(field)
			const rpc = await batchModels(f.controller, { value: JSON.stringify({ taskId: "task", field: field.key }) })
			expect(JSON.parse(rpc.value)).toEqual([])
			expect(await f.table.execute("task", { action: "models", range: "C2" }, "agent")).toMatchObject({ items: [] })
			expect(f.models).not.toHaveBeenCalled()
			const session = await f.snapshot()
			expect(() => rangePatches(buildSheet(session), "C2", [["text-a"]])).toThrow("推荐默认")
			await expect(
				f.service.command("task", {
					action: "patch",
					revision: session.revision,
					rows: [{ id: session.rows[0].id, values: { [field.key]: "text-a" } }],
				}),
			).rejects.toThrow("推荐默认")
			await f.table.execute("task", { action: "write", range: "C2", revision: session.revision, values: [["推荐默认"]] })
			expect(canonicalRows(await f.snapshot())).toEqual([{}])
		})
	}
})
