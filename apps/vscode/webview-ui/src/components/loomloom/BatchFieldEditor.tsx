import type { BatchField, BatchInputContext, BatchRow, BatchValue } from "@shared/loomloom"
import { getBatchFileInputMode } from "@shared/loomloom-files"
import { resolveBatchModelField } from "@shared/loomloom-models"
import { StringRequest } from "@shared/proto/cline/common"
import { useEffect, useId, useState } from "react"
import { LoomLoomServiceClient } from "@/services/grpc-client"
import { attachToRow, sendBatch } from "./batch-api"

export function BatchFieldEditor({
	field,
	value,
	onChange,
	taskId,
}: {
	field: BatchField
	value: BatchValue | undefined
	onChange: (value: BatchValue) => void
	taskId: string
}) {
	const fieldId = useId()
	const [models, setModels] = useState<{ id: string; name: string }[]>([])
	const [error, setError] = useState("")
	const [loading, setLoading] = useState(false)
	const [retry, setRetry] = useState(0)
	const modelField = resolveBatchModelField(field)
	const { isModel, stepType, allowOverride, defaultModelId } = modelField
	useEffect(() => {
		let cancelled = false
		setModels([])
		setError("")
		setLoading(false)
		if (stepType && allowOverride) {
			setLoading(true)
			void LoomLoomServiceClient.batchModels(StringRequest.create({ value: JSON.stringify({ taskId, field: field.key }) }))
				.then((r) => {
					if (!cancelled) setModels(JSON.parse(r.value))
				})
				.catch((e: unknown) => {
					if (!cancelled) setError(e instanceof Error ? e.message : "暂时无法加载模型，可继续使用推荐默认。")
				})
				.finally(() => {
					if (!cancelled) setLoading(false)
				})
		}
		return () => {
			cancelled = true
		}
	}, [field.key, stepType, allowOverride, taskId, retry])
	const choices = models.filter((model) => !field.enum_values?.length || field.enum_values.includes(model.id))
	return (
		<div className="batch-field">
			<label htmlFor={fieldId}>
				{field.label || field.key}
				{field.required ? " *" : ""}
			</label>
			{field.value_type === "asset_ref" ? (
				<small>请使用「添加文件」选择本地文件，上传后自动绑定。</small>
			) : isModel ? (
				<>
					<select
						aria-busy={loading}
						aria-label={field.label || field.key}
						id={fieldId}
						onChange={(e) => onChange(e.target.value)}
						value={String(value ?? "")}>
						<option value="">推荐默认 · {defaultModelId || "由 SkillBot 选择"}</option>
						{!!value && !choices.some((m) => m.id === value) && (
							<option disabled value={String(value)}>
								{String(value)}（当前值，未在可选列表中）
							</option>
						)}
						{loading && (
							<option disabled value="__batch_models_loading__">
								正在加载支持的模型…
							</option>
						)}
						{choices.length > 0 && (
							<optgroup label="LoomLoom 支持的模型">
								{choices.map((m) => (
									<option key={m.id} value={m.id}>
										{m.name === m.id ? m.id : `${m.name} — ${m.id}`}
									</option>
								))}
							</optgroup>
						)}
					</select>
					{!allowOverride && (
						<small>
							{field.model_override?.allow_override === false
								? "此 SkillBot 固定使用默认模型。"
								: "此字段未标明模型类型，暂保留 SkillBot 默认配置。"}
						</small>
					)}
					{allowOverride && !loading && !error && choices.length === 0 && (
						<small>当前没有可用的替代模型，可以继续使用推荐默认。</small>
					)}
					{error && <small role="alert">模型列表加载失败：{error} 推荐默认仍可使用。</small>}
					{allowOverride && (
						<button className="batch-link" disabled={loading} onClick={() => setRetry((n) => n + 1)} type="button">
							{error ? "重试加载模型" : "刷新模型列表"}
						</button>
					)}
				</>
			) : field.enum_values?.length ? (
				<select
					id={fieldId}
					onChange={(e) => onChange(field.enum_values!.find((v) => String(v) === e.target.value) ?? "")}
					value={String(value ?? "")}>
					<option value="">{field.required ? "请选择" : "推荐默认"}</option>
					{field.enum_values.map((v) => (
						<option key={String(v)} value={String(v)}>
							{String(v)}
						</option>
					))}
				</select>
			) : field.value_type === "boolean" ? (
				<select
					id={fieldId}
					onChange={(e) => onChange(e.target.value === "" ? "" : e.target.value === "true")}
					value={value === undefined ? "" : String(value)}>
					<option value="">请选择</option>
					<option value="true">是</option>
					<option value="false">否</option>
				</select>
			) : (
				<textarea
					id={fieldId}
					onChange={(e) => onChange(e.target.value)}
					rows={field.presentation?.widget === "textarea" ? 6 : 3}
					value={String(value ?? "")}
				/>
			)}
			<small>{field.presentation?.hint || field.description}</small>
		</div>
	)
}

export function BatchRowEditor({
	session,
	row,
	index,
	close,
	saved,
}: {
	session: BatchInputContext
	row: BatchRow
	index: number
	close: () => void
	saved: (next: boolean, revision: number) => void
}) {
	const [values, setValues] = useState(row.values)
	const [baseRevision] = useState(session.revision)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState("")
	const fields = session.listing?.schema?.fields ?? []
	const stale = baseRevision !== session.revision
	const dirty = JSON.stringify(values) !== JSON.stringify(row.values)
	async function save(next: boolean) {
		setBusy(true)
		setError("")
		try {
			const updated = await sendBatch(
				{ action: "patch", revision: baseRevision, rows: [{ id: row.id, values }] },
				session.taskId,
			)
			saved(next, updated?.revision ?? baseRevision + 1)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}
	return (
		<div aria-label={`填写第 ${index + 1} 条`} className="batch-editor" role="dialog">
			<strong>
				第 {index + 1} / {session.rows.length} 条输入
			</strong>
			{fields.map((field) => (
				<BatchFieldEditor
					field={field}
					key={field.key}
					onChange={(v) => setValues((old) => ({ ...old, [field.key]: v }))}
					taskId={session.taskId}
					value={values[field.key]}
				/>
			))}
			{row.attachments.map((file) => (
				<div className="batch-file" key={file.id}>
					▣ {file.name}
				</div>
			))}
			{stale && <p role="alert">输入已更新，请关闭后重新打开本条，避免覆盖新内容。</p>}
			{error && <p role="alert">{error}</p>}
			<div className="batch-actions">
				{[undefined, ...fields.filter((f) => !!getBatchFileInputMode(f)).map((f) => f.key)].map((field) => (
					<button
						disabled={busy || stale || dirty}
						key={field ?? "ref"}
						onClick={() => {
							setBusy(true)
							void attachToRow(session, row.id, field)
								.then(() => {
									close()
								})
								.catch((e) => setError(String(e.message || e)))
								.finally(() => setBusy(false))
						}}>
						{field
							? `${getBatchFileInputMode(fields.find((f) => f.key === field)) === "text" ? "导入文本到" : "上传"}${fields.find((f) => f.key === field)?.label || field}`
							: "添加本地参考文件"}
					</button>
				))}
				<button disabled={busy} onClick={close}>
					关闭
				</button>
				<button disabled={busy || stale} onClick={() => void save(false)}>
					保存本条
				</button>
				{index + 1 < session.rows.length && (
					<button className="primary" disabled={busy || stale} onClick={() => void save(true)}>
						保存并填写下一条
					</button>
				)}
			</div>
			<small>添加文件前请先保存文字；文件名将同步到工作表。</small>
			<small>文本导入会将文件正文放入对应字段，随报价和运行发送到 LoomLoom；本地参考文件不会自动当作云端素材上传。</small>
		</div>
	)
}
