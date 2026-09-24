import { randomUUID } from "node:crypto"
import { getBatchFileInputMode } from "@shared/loomloom-files"
import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { ShowMessageType } from "@shared/proto/host/window"
import { z } from "zod"
import { HostProvider } from "@/hosts/host-provider"
import { readBatchInputFile } from "@/services/loomloom/input-file-adapter"
import type { Controller } from "../index"

export async function selectBatchAttachment(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const input = z
		.object({
			taskId: z.string().min(1),
			rowId: z.string().min(1),
			revision: z.number().int().nonnegative(),
			field: z.string().min(1).optional(),
			sourceAttachmentId: z.string().min(1).max(200).optional(),
		})
		.strict()
		.parse(JSON.parse(request.value))
	if (input.taskId !== controller.task?.taskId) throw new Error("会话已切换。")
	const session = await controller.batch.snapshot(input.taskId)
	const row = session?.rows.find((r) => r.id === input.rowId)
	const field = session?.listing?.schema?.fields.find((f) => f.key === input.field)
	if (!session?.enabled || session.revision !== input.revision || session.attempt || session.phase === "quoting" || !row)
		throw new Error("请选择当前批次中尚未提交的输入行。")
	const mode = input.field ? (field ? getBatchFileInputMode(field) : undefined) : "reference"
	if (!mode || (input.sourceAttachmentId && (!field || mode === "reference")))
		throw new Error("此字段不支持文件导入。请选择明确的文本输入或素材字段；文件引用格式不能自动猜测。")
	const sourceAttachment = input.sourceAttachmentId
		? row.attachments.find((attachment) => attachment.id === input.sourceAttachmentId)
		: undefined
	if (input.sourceAttachmentId && !sourceAttachment) throw new Error("此参考文件不属于当前输入行，请重新选择。")
	if (sourceAttachment && !sourceAttachment.path) throw new Error("此参考文件缺少本地路径，请重新添加文件。")
	const assertCurrent = async () => {
		const latest = await controller.batch.snapshot(input.taskId)
		const latestRow = latest?.rows.find((candidate) => candidate.id === input.rowId)
		if (
			controller.task?.taskId !== input.taskId ||
			latest?.id !== session.id ||
			latest.revision !== input.revision ||
			latest.attempt ||
			!latest.enabled ||
			latest.phase === "quoting" ||
			!latestRow ||
			(sourceAttachment &&
				!latestRow.attachments.some((a) => a.id === sourceAttachment.id && a.path === sourceAttachment.path))
		)
			throw new Error("选择文件期间任务或输入发生变化，请重新添加。")
	}
	await assertCurrent()
	if (
		mode === "text" &&
		field &&
		row.values[field.key] !== undefined &&
		row.values[field.key] !== null &&
		row.values[field.key] !== ""
	) {
		const confirmation = sourceAttachment ? "导入文件并替换" : "选择文件并替换"
		const answer = await HostProvider.window.showMessage({
			type: ShowMessageType.WARNING,
			message: `导入文件会替换「${field.label || field.key}」的当前文本。`,
			options: {
				modal: true,
				detail: "文件内容会保存在输入草稿里，并在报价、运行时发送给 LoomLoom。请勿导入密钥或其他不希望上传的内容。",
				items: [confirmation],
			},
		})
		if (answer.selectedOption !== confirmation) return StringResponse.create({ value: "null" })
		await assertCurrent()
	}
	let source = sourceAttachment?.path
	if (!source) {
		const selected = await HostProvider.window.showOpenDialogue({
			canSelectMany: false,
			openLabel:
				mode === "asset" ? "上传到 LoomLoom 并添加" : mode === "text" ? "导入文本（将随批输入发送）" : "添加本地参考文件",
		})
		source = selected.paths?.[0]
		if (!source) return StringResponse.create({ value: "null" })
	}
	await assertCurrent()
	const prepared = await readBatchInputFile(source, mode)
	if (
		mode === "asset" &&
		field?.accepted_mime_types?.length &&
		!field.accepted_mime_types.some(
			(accepted) =>
				accepted === prepared.mimeType ||
				(accepted.endsWith("/*") && prepared.mimeType.startsWith(accepted.slice(0, -1))),
		)
	)
		throw new Error("文件格式不在此 SkillBot 支持范围内。")
	await assertCurrent()
	let inputAssetId: string | undefined
	if (mode === "asset") {
		if (prepared.base64 === undefined) throw new Error("文件未读取为有效素材，请重新选择。")
		inputAssetId = await controller.loomLoom.upload(prepared.name, prepared.mimeType, prepared.base64)
		await assertCurrent()
	}
	await controller.batch.attach(
		input.taskId,
		input.revision,
		input.rowId,
		{
			id:
				sourceAttachment && (!sourceAttachment.field || sourceAttachment.field === field?.key)
					? sourceAttachment.id
					: randomUUID(),
			name: prepared.name,
			path: prepared.path,
			field: field?.key,
			inputAssetId,
			mode,
			mimeType: prepared.mimeType,
			sizeBytes: prepared.sizeBytes,
			sha256: prepared.sha256,
		},
		mode === "text" ? prepared.text : undefined,
	)
	return StringResponse.create({ value: JSON.stringify(await controller.batch.snapshot(input.taskId)) })
}
