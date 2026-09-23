import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { type BatchSession, canonicalRows, type SkillBot } from "@shared/loomloom"
import { selectBatchAttachment } from "@/core/controller/loomLoom/selectBatchAttachment"
import { HostProvider } from "@/hosts/host-provider"
import { BatchService } from "./batch-service"
import type { BatchApi } from "./client"
import * as fileAdapter from "./input-file-adapter"
import { BatchTableService, type TableNativePort } from "./table-operations"

const services: BatchService[] = []
afterEach(() => {
	mock.restore()
	for (const service of services.splice(0)) service.dispose()
})

async function setup() {
	const listing: SkillBot = {
		id: "listing",
		name: "Import test",
		versionId: "v1",
		description: "",
		availability: "available",
		schema: {
			schema_version: "loom_market_public_input_schema_v1",
			fields: [
				{ key: "text", value_type: "string" },
				{ key: "asset", value_type: "asset_ref", accepted_mime_types: ["image/*"] },
				{ key: "choice", value_type: "string", enum_values: ["a"] },
				{ key: "text_model", value_type: "string" },
				{ key: "reference", value_type: "text_reference" },
				{ key: "image_url", value_type: "image_url" },
			],
		},
	}
	const saved: BatchSession[] = []
	const api: BatchApi = {
		detail: async () => structuredClone(listing),
		quote: mock(async (_id, _version, rows) => ({
			taskCount: rows.length,
			estimatedBuyerPayable: { amount: "0.1", currency: "CNY" },
		})),
		execute: mock(async () => ({ runId: "run1" })),
		run: async () => ({ status: "running", total: 2, completed: 0, failed: 0, rows: [], artifacts: [] }),
	}
	const batch = new BatchService(
		{
			loadAll: async () => [],
			save: async (session) => {
				saved.push(structuredClone(session))
			},
		},
		api,
		() => {},
		60_000,
	)
	services.push(batch)
	await batch.setEnabled("task", true)
	const selected = await batch.command("task", { action: "select", listingId: listing.id })
	await batch.command("task", { action: "quantity", revision: selected.revision, count: 2 })
	const snapshot = async () => {
		const session = await batch.snapshot("task")
		if (!session) throw new Error("Missing test session")
		return session
	}
	let session = await snapshot()
	await batch.attach("task", session.revision, session.rows[0].id, {
		id: "source",
		name: "source.ts",
		path: "D:/selected/source.ts",
		mode: "reference",
	})
	session = await snapshot()
	await batch.attach("task", session.revision, session.rows[1].id, {
		id: "other-row-source",
		name: "private.txt",
		path: "D:/selected/other.txt",
		mode: "reference",
	})
	const windowClient = {
		showOpenDialogue: mock(async () => ({ paths: ["D:/selected/picked.ts"] })),
		showMessage: mock(async () => ({ selectedOption: "导入文件并替换" })),
	}
	spyOn(HostProvider, "get").mockReturnValue({ hostBridge: { windowClient } } as unknown as HostProvider)
	const reader = spyOn(fileAdapter, "readBatchInputFile").mockImplementation(async (path, mode) => ({
		path,
		name: path.split("/").at(-1) ?? "source.ts",
		mimeType: mode === "asset" ? "image/png" : "text/plain",
		sizeBytes: 19,
		sha256: mode === "reference" ? undefined : "a".repeat(64),
		text: mode === "text" ? "const answer = 42\n" : undefined,
		base64: mode === "asset" ? "cGljdHVyZQ==" : undefined,
	}))
	const upload = mock(async () => "ia_uploaded")
	const mutableController = { task: { taskId: "task" }, batch, loomLoom: { upload } }
	const controller = mutableController as unknown as Parameters<typeof selectBatchAttachment>[0]
	const attach = spyOn(batch, "attach")
	async function rpc(extra: Record<string, unknown> = {}) {
		const current = await snapshot()
		return selectBatchAttachment(controller, {
			value: JSON.stringify({
				taskId: "task",
				rowId: current.rows[0].id,
				revision: current.revision,
				...extra,
			}),
		})
	}
	const port: TableNativePort = {
		open: async () => {},
		action: async () => {},
		models: async () => [],
		attach: mock(async (taskId, revision, rowId, field, sourceAttachmentId) => {
			await selectBatchAttachment(controller, {
				value: JSON.stringify({ taskId, revision, rowId, field, sourceAttachmentId }),
			})
		}),
	}
	const table = new BatchTableService(batch, port, () => mutableController.task.taskId)
	async function quote() {
		await batch.command("task", { action: "review", revision: (await snapshot()).revision })
		return batch.command("task", { action: "quote", revision: (await snapshot()).revision })
	}
	return { batch, api, saved, snapshot, windowClient, reader, upload, attach, mutableController, rpc, table, port, quote }
}

describe("Batch selected-file import integration", () => {
	it("imports a same-row reference atomically, reuses its ID, and invalidates the quote without a picker", async () => {
		const f = await setup()
		const before = await f.quote()
		await f.table.execute(
			"task",
			{ action: "import_reference", range: "C2", revision: before.revision, attachmentId: "source" },
			"agent",
		)
		const after = await f.snapshot()
		expect(f.port.attach).toHaveBeenCalledWith("task", before.revision, before.rows[0].id, "text", "source")
		expect(f.reader).toHaveBeenCalledWith("D:/selected/source.ts", "text")
		expect(f.windowClient.showOpenDialogue).not.toHaveBeenCalled()
		expect(f.upload).not.toHaveBeenCalled()
		expect(after.rows[0].values.text).toBe("const answer = 42\n")
		expect(after.rows[0].attachments).toHaveLength(1)
		expect(after.rows[0].attachments[0]).toMatchObject({ id: "source", name: "source.ts", field: "text", mode: "text" })
		expect(after.quote?.valid).toBe(false)
		expect(after.revision).toBe(before.revision + 1)
		expect(f.saved.at(-1)?.rows[0]).toEqual(after.rows[0])
		expect(f.api.execute).not.toHaveBeenCalled()
	})

	it("clears an untouched imported value on removal, but preserves a subsequent manual edit", async () => {
		const f = await setup()
		await f.rpc({ field: "text", sourceAttachmentId: "source" })
		let session = await f.snapshot()
		await f.batch.command("task", {
			action: "removeAttachment",
			revision: session.revision,
			rowId: session.rows[0].id,
			attachmentId: "source",
		})
		expect((await f.snapshot()).rows[0].values.text).toBeUndefined()
		await f.rpc({ field: "text" })
		session = await f.snapshot()
		await f.batch.command("task", {
			action: "patch",
			revision: session.revision,
			rows: [{ id: session.rows[0].id, values: { text: "user edited" } }],
		})
		session = await f.snapshot()
		await f.batch.command("task", {
			action: "removeAttachment",
			revision: session.revision,
			rowId: session.rows[0].id,
			attachmentId: session.rows[0].attachments[0].id,
		})
		expect((await f.snapshot()).rows[0].values.text).toBe("user edited")
	})

	it("deduplicates reimports and replaces previous attachments for the target field", async () => {
		const f = await setup()
		await f.rpc({ field: "text", sourceAttachmentId: "source" })
		await f.rpc({ field: "text", sourceAttachmentId: "source" })
		expect((await f.snapshot()).rows[0].attachments).toHaveLength(1)
		f.windowClient.showMessage.mockResolvedValue({ selectedOption: "选择文件并替换" })
		await f.rpc({ field: "text" })
		const session = await f.snapshot()
		expect(session.rows[0].attachments).toHaveLength(1)
		expect(session.rows[0].attachments[0].name).toBe("picked.ts")
	})

	it("preserves an existing field binding when its file is imported into another field", async () => {
		const f = await setup()
		await f.rpc({ field: "asset", sourceAttachmentId: "source" })
		const before = await f.snapshot()
		const original = before.rows[0].attachments[0]
		await f.rpc({ field: "text", sourceAttachmentId: "source" })
		const imported = await f.snapshot()
		const copied = imported.rows[0].attachments.find((attachment) => attachment.field === "text")
		expect(copied).toBeDefined()
		expect(copied?.id).not.toBe(original.id)
		expect(imported.rows[0].attachments).toHaveLength(2)
		expect(imported.rows[0].attachments.find((attachment) => attachment.id === original.id)).toEqual(original)
		expect(imported.rows[0].values.asset).toBe("ia_uploaded")
		expect(canonicalRows(imported)[0]).toEqual({ asset: "ia_uploaded", text: "const answer = 42\n" })
		if (!copied) throw new Error("Expected copied field binding")
		await f.batch.command("task", {
			action: "removeAttachment",
			revision: imported.revision,
			rowId: imported.rows[0].id,
			attachmentId: copied.id,
		})
		const removed = await f.snapshot()
		expect(removed.rows[0].attachments).toEqual([original])
		expect(removed.rows[0].values.text).toBeUndefined()
		expect(canonicalRows(removed)[0]).toEqual({ asset: "ia_uploaded" })
		expect(f.windowClient.showOpenDialogue).not.toHaveBeenCalled()
	})

	it("leaves text, filenames and quote unchanged when native overwrite confirmation is cancelled", async () => {
		const f = await setup()
		const initial = await f.snapshot()
		await f.batch.command("task", {
			action: "patch",
			revision: initial.revision,
			rows: [{ id: initial.rows[0].id, values: { text: "existing" } }],
		})
		const before = await f.quote()
		f.windowClient.showMessage.mockResolvedValue({ selectedOption: "" })
		expect((await f.rpc({ field: "text", sourceAttachmentId: "source" })).value).toBe("null")
		expect(await f.snapshot()).toEqual(before)
		expect(f.reader).not.toHaveBeenCalled()
		expect(f.attach).not.toHaveBeenCalled()
	})

	it("uploads reused media once and saves its server asset ID, without exposing another filesystem input", async () => {
		const f = await setup()
		await f.rpc({ field: "asset", sourceAttachmentId: "source" })
		expect(f.reader).toHaveBeenCalledWith("D:/selected/source.ts", "asset")
		expect(f.upload).toHaveBeenCalledWith("source.ts", "image/png", "cGljdHVyZQ==")
		expect(f.windowClient.showOpenDialogue).not.toHaveBeenCalled()
		expect((await f.snapshot()).rows[0]).toMatchObject({
			values: { asset: "ia_uploaded" },
			attachments: [{ id: "source", field: "asset", inputAssetId: "ia_uploaded" }],
		})
	})

	it("requires a same-row attachment ID and an explicit compatible target field", async () => {
		const f = await setup()
		for (const extra of [
			{ sourceAttachmentId: "source" },
			{ sourceAttachmentId: "other-row-source", field: "text" },
			{ sourceAttachmentId: "source", field: "reference" },
			{ sourceAttachmentId: "source", field: "image_url" },
			{ sourceAttachmentId: "source", field: "text_model" },
			{ sourceAttachmentId: "source", field: "choice" },
			{ field: "text", sourcePath: "D:/not-selected.txt" },
		])
			await expect(f.rpc(extra)).rejects.toThrow()
		expect(f.reader).not.toHaveBeenCalled()
		expect(f.windowClient.showOpenDialogue).not.toHaveBeenCalled()
		expect(f.attach).not.toHaveBeenCalled()
	})

	it("table import rejects other rows, attachment columns, missing IDs and stale revisions", async () => {
		const f = await setup()
		const s = await f.snapshot()
		for (const operation of [
			{ range: "C3", attachmentId: "source" },
			{ range: "I2", attachmentId: "source" },
			{ range: "C2" },
			{ range: "C2", attachmentId: "source", revision: s.revision - 1 },
		])
			await expect(
				f.table.execute("task", { action: "import_reference", revision: s.revision, ...operation }, "agent"),
			).rejects.toThrow()
		expect(f.port.attach).not.toHaveBeenCalled()
	})

	it("rechecks the active task after a picker or file read completes", async () => {
		const f = await setup()
		f.windowClient.showOpenDialogue.mockImplementation(async () => {
			f.mutableController.task.taskId = "other"
			return { paths: ["D:/selected/picked.ts"] }
		})
		await expect(f.rpc({ field: "text" })).rejects.toThrow("发生变化")
		expect(f.reader).not.toHaveBeenCalled()
		f.mutableController.task.taskId = "task"
		f.reader.mockImplementation(async () => {
			f.mutableController.task.taskId = "other"
			return { path: "D:/selected/source.ts", name: "source.ts", mimeType: "text/plain", sizeBytes: 4, text: "text" }
		})
		await expect(f.rpc({ field: "text", sourceAttachmentId: "source" })).rejects.toThrow("发生变化")
		expect(f.attach).not.toHaveBeenCalled()
	})

	it("rejects an input revision changed during file reading before upload or attachment mutation", async () => {
		const f = await setup()
		f.reader.mockImplementation(async () => {
			const s = await f.snapshot()
			await f.batch.command("task", {
				action: "patch",
				revision: s.revision,
				rows: [{ id: s.rows[0].id, values: { text: "newer" } }],
			})
			return { path: "D:/selected/source.ts", name: "source.ts", mimeType: "image/png", sizeBytes: 4, base64: "abcd" }
		})
		await expect(f.rpc({ field: "asset", sourceAttachmentId: "source" })).rejects.toThrow("发生变化")
		expect(f.upload).not.toHaveBeenCalled()
		expect(f.attach).not.toHaveBeenCalled()
		expect((await f.snapshot()).rows[0].values.text).toBe("newer")
	})

	it("rejects task switching during upload before associating the uploaded asset", async () => {
		const f = await setup()
		f.upload.mockImplementation(async () => {
			f.mutableController.task.taskId = "other"
			return "ia_uploaded"
		})
		await expect(f.rpc({ field: "asset", sourceAttachmentId: "source" })).rejects.toThrow("发生变化")
		expect(f.attach).not.toHaveBeenCalled()
		expect((await f.snapshot()).rows[0].values.asset).toBeUndefined()
	})

	it("rejects unsupported MIME before upload, and picker cancellation has no side effects", async () => {
		const f = await setup()
		f.reader.mockResolvedValue({
			path: "D:/selected/source.ts",
			name: "source.pdf",
			mimeType: "application/pdf",
			sizeBytes: 4,
			base64: "abcd",
		})
		await expect(f.rpc({ field: "asset", sourceAttachmentId: "source" })).rejects.toThrow("支持范围")
		expect(f.upload).not.toHaveBeenCalled()
		f.windowClient.showOpenDialogue.mockResolvedValue({ paths: [] })
		expect((await f.rpc({ field: "text" })).value).toBe("null")
		expect(f.attach).not.toHaveBeenCalled()
	})
})
