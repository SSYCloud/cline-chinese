import { StringRequest } from "@shared/proto/cline/common"
import { useEffect, useMemo, useRef, useState } from "react"
import { LoomLoomServiceClient } from "@/services/grpc-client"
import { buildSimpleCreatorSpec, type CreatorProfile, parseAdvancedCreatorSpec, simpleTextProfiles } from "./creator-spec-v2"
import "./CreatorWorkbench.css"

type Money = { amount: string; currency: string }
type Precheck = {
	estimatedTotalCostT: number
	estimatedTotalCost?: Money
	pricingRevision: string
	balanceCheck?: { isSufficient?: boolean; availableBalanceMoney?: Money }
}
type Review = { id?: string; status?: string; reviewReason?: string; listingId?: string }
type PrivateTemplate = { templateId: string; name: string; latestVersionId?: string }
type PrivateVersion = { versionId: string; versionNumber?: number; createdAtUnix?: number }
type CreatorEarning = { id?: string; amount?: Money; incomePostStatus?: string }

/** Serializable state owned by BatchWorksheet, restored with the editor Webview. */
export type CreatorDraft = {
	version: 1
	mode: "simple" | "advanced"
	name: string
	description: string
	instruction: string
	samplePrompt: string
	profileId: string
	modelId: string
	advancedJson: string
	templateId: string
	versionId: string
	validatedSpecJson: string
	savedSpecJson: string
	displayName: string
	listingDescription: string
	feeAmount: string
	feeCurrency: string
	inputFileId: string
	precheck: Precheck | null
	testRunId: string
	testRunVersionId: string
	testRunStatus: string
	testCompletedTasks: number
	testTotalTasks: number
	testFailedTasks: number
	testCancelledTasks: number
	testSubmissionUnknown: boolean
	reviewRequestId: string
	listingId: string
	reviewStatus: string
}

export function createCreatorDraft(): CreatorDraft {
	return {
		version: 1,
		mode: "simple",
		name: "",
		description: "",
		instruction: "",
		samplePrompt: "",
		profileId: "",
		modelId: "",
		advancedJson: "",
		templateId: "",
		versionId: "",
		validatedSpecJson: "",
		savedSpecJson: "",
		displayName: "",
		listingDescription: "",
		feeAmount: "",
		feeCurrency: "",
		inputFileId: "",
		precheck: null,
		testRunId: "",
		testRunVersionId: "",
		testRunStatus: "",
		testCompletedTasks: 0,
		testTotalTasks: 0,
		testFailedTasks: 0,
		testCancelledTasks: 0,
		testSubmissionUnknown: false,
		reviewRequestId: "",
		listingId: "",
		reviewStatus: "",
	}
}

type Props = {
	taskId: string
	draft: CreatorDraft
	onDraftChange: (draft: CreatorDraft) => void
	onFlushDraft?: () => Promise<void>
	onBack?: () => void
	readonly?: boolean
}

const request = (value: unknown) => StringRequest.create({ value: JSON.stringify(value) })
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
const isObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === "object" && !Array.isArray(value)

async function creatorCommand(taskId: string, command: Record<string, unknown>): Promise<Record<string, unknown>> {
	const response = await LoomLoomServiceClient.creatorCommand(request({ taskId, command }))
	const value: unknown = JSON.parse(response.value)
	if (!isObject(value)) throw new Error("LoomLoom 返回了无法识别的数据。")
	return value
}

function sampleValues(spec: Record<string, unknown>): Record<string, unknown> {
	const workbook = spec.workbook
	const rows = isObject(workbook) ? workbook.sampleRows : undefined
	const first = Array.isArray(rows) ? rows[0] : undefined
	const values = isObject(first) ? first.values : undefined
	if (!isObject(values) || Object.keys(values).length === 0) {
		throw new Error("请在模板示例中填写一条输入，用于私有测试运行。")
	}
	return values
}

function completeTestRun(draft: CreatorDraft) {
	return (
		draft.testRunVersionId === draft.versionId &&
		draft.testRunStatus === "completed" &&
		draft.testTotalTasks > 0 &&
		draft.testCompletedTasks === draft.testTotalTasks &&
		draft.testFailedTasks === 0 &&
		draft.testCancelledTasks === 0
	)
}

export function CreatorWorkbench({ taskId, draft, onDraftChange, onFlushDraft, onBack, readonly = false }: Props) {
	const draftRef = useRef(draft)
	draftRef.current = draft
	const busyRef = useRef(false)
	const [profiles, setProfiles] = useState<CreatorProfile[]>([])
	const [contextState, setContextState] = useState<"loading" | "ready" | "error">("loading")
	const [busy, setBusy] = useState("")
	const [error, setError] = useState("")
	const [notice, setNotice] = useState("")
	const [confirm, setConfirm] = useState<"create" | "version" | "run" | "publish" | "">("")
	const [templates, setTemplates] = useState<PrivateTemplate[]>([])
	const [versions, setVersions] = useState<PrivateVersion[]>([])
	const [earnings, setEarnings] = useState<{ items: CreatorEarning[]; totalAmount?: Money; totalCount?: number } | null>(null)
	const textProfiles = useMemo(() => simpleTextProfiles(profiles), [profiles])
	const chosenProfile = textProfiles.find((profile) => profile.profileId === draft.profileId)
	const models = chosenProfile?.eligibleModels ?? []

	function update(patch: Partial<CreatorDraft>) {
		const next = { ...draftRef.current, ...patch }
		draftRef.current = next
		onDraftChange(next)
		setConfirm("")
		setError("")
	}

	function changeDesign(patch: Partial<CreatorDraft>) {
		update({ ...patch, validatedSpecJson: "", inputFileId: "", precheck: null })
	}

	async function run<T>(label: string, job: () => Promise<T>): Promise<T | undefined> {
		if (busyRef.current) return undefined
		busyRef.current = true
		setBusy(label)
		setError("")
		setNotice("")
		try {
			return await job()
		} catch (cause) {
			setError(errorMessage(cause))
			return undefined
		} finally {
			busyRef.current = false
			setBusy("")
		}
	}

	async function loadContext() {
		setContextState("loading")
		try {
			const result = await creatorCommand(taskId, { action: "context" })
			const available = Array.isArray(result.profiles) ? (result.profiles as CreatorProfile[]) : []
			setProfiles(available)
			setContextState("ready")
			const first = simpleTextProfiles(available)[0]
			if (!draftRef.current.profileId && first) {
				update({ profileId: first.profileId, modelId: first.eligibleModels?.[0]?.modelId ?? "" })
			}
		} catch (cause) {
			setContextState("error")
			setError(errorMessage(cause))
		}
	}

	useEffect(() => {
		void loadContext()
		// A task-pinned editor loads its own current authoring authority once when opened.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [taskId])

	const spec = useMemo(() => {
		try {
			return {
				value:
					draft.mode === "simple"
						? buildSimpleCreatorSpec(draft, profiles)
						: parseAdvancedCreatorSpec(draft.advancedJson),
				error: "",
			}
		} catch (cause) {
			return { value: null, error: errorMessage(cause) }
		}
	}, [
		draft.mode,
		draft.name,
		draft.description,
		draft.instruction,
		draft.samplePrompt,
		draft.profileId,
		draft.modelId,
		draft.advancedJson,
		profiles,
	])
	const specJson = spec.value ? JSON.stringify(spec.value) : ""
	const validated = !!specJson && draft.validatedSpecJson === specJson
	const saved = !!specJson && draft.savedSpecJson === specJson && !!draft.versionId
	const testPassed = saved && completeTestRun(draft)
	const validFee = /^(?:0|[1-9]\d*)(?:\.\d{1,7})?$/.test(draft.feeAmount.trim()) && /^[A-Z]{3}$/.test(draft.feeCurrency.trim())
	const canPublish = !readonly && !busy && testPassed && !!draft.displayName.trim() && validFee
	const specName = isObject(spec.value?.meta) && typeof spec.value.meta.name === "string" ? spec.value.meta.name : draft.name

	function switchMode(mode: "simple" | "advanced") {
		if (mode === draft.mode) return
		if (mode === "advanced" && !draft.advancedJson.trim() && spec.value) {
			changeDesign({ mode, advancedJson: JSON.stringify(spec.value, null, 2) })
		} else {
			changeDesign({ mode })
		}
	}

	async function validate() {
		if (!spec.value || readonly) return
		await run("validate", async () => {
			const result = await creatorCommand(taskId, {
				action: "validate",
				specVersion: "template-spec/v2",
				canonicalSpecV2: spec.value,
			})
			if (result.valid !== true) throw new Error("服务端未通过校验；请检查输入与能力配置。")
			update({ validatedSpecJson: specJson })
			setNotice("服务端校验通过，可以创建私有模板或保存新版本。")
		})
	}

	async function createTemplate() {
		if (!validated || readonly || draft.templateId) return
		await run("create", async () => {
			const result = await creatorCommand(taskId, {
				action: "createTemplate",
				name: specName.trim(),
				description:
					isObject(spec.value?.meta) && typeof spec.value.meta.description === "string"
						? spec.value.meta.description
						: draft.description.trim(),
				confirm: true,
			})
			if (typeof result.templateId !== "string" || !result.templateId)
				throw new Error("未收到私有模板 ID，请先检查远端状态。")
			update({ templateId: result.templateId })
			setNotice("私有模板容器已创建。下一步保存不可变版本。")
		})
	}

	async function saveVersion() {
		if (!validated || readonly || !draft.templateId || !spec.value) return
		await run("version", async () => {
			const result = await creatorCommand(taskId, {
				action: "saveVersion",
				templateId: draft.templateId,
				specVersion: "template-spec/v2",
				canonicalSpecV2: spec.value,
				confirm: true,
			})
			if (typeof result.versionId !== "string" || !result.versionId) throw new Error("未收到版本 ID，请先检查远端状态。")
			update({
				versionId: result.versionId,
				savedSpecJson: specJson,
				inputFileId: "",
				precheck: null,
				testRunId: "",
				testRunVersionId: "",
				testRunStatus: "",
				testSubmissionUnknown: false,
			})
			setNotice("不可变版本已保存。先完成一次私有测试，再提交市场审核。")
		})
	}

	async function precheckTest() {
		if (
			!saved ||
			readonly ||
			!spec.value ||
			(draft.testSubmissionUnknown && !draft.testRunId) ||
			(draft.testRunId && !["completed", "failed", "cancelled"].includes(draft.testRunStatus))
		)
			return
		await run("precheck", async () => {
			const values = sampleValues(spec.value)
			const uploaded = await creatorCommand(taskId, {
				action: "uploadPrivateInput",
				jsonl: `${JSON.stringify(values)}\n`,
			})
			if (typeof uploaded.inputFileId !== "string" || !uploaded.inputFileId) {
				throw new Error("示例输入上传后未返回文件 ID。")
			}
			const quoted = await creatorCommand(taskId, {
				action: "precheckPrivate",
				templateId: draft.templateId,
				versionId: draft.versionId,
				inputFileId: uploaded.inputFileId,
			})
			if (!Number.isSafeInteger(quoted.estimatedTotalCostT) || typeof quoted.pricingRevision !== "string") {
				throw new Error("服务端没有返回完整费用预估，不能运行私有测试。")
			}
			const precheck = quoted as Precheck
			update({
				inputFileId: uploaded.inputFileId,
				precheck,
				testSubmissionUnknown: false,
				testRunId: "",
				testRunStatus: "",
				testCompletedTasks: 0,
				testTotalTasks: 0,
				testFailedTasks: 0,
				testCancelledTasks: 0,
			})
			setNotice("私有测试预算已返回，请确认费用后再运行。")
		})
	}

	async function runPrivateTest() {
		const current = draftRef.current
		if (!saved || readonly || !current.precheck || !current.inputFileId || current.testSubmissionUnknown) return
		const quoted = current.precheck
		// Persist an attempt before crossing the paid boundary. A transport failure is
		// ambiguous, so the UI does not offer a blind retry.
		update({ testSubmissionUnknown: true })
		await run("run", async () => {
			const result = await creatorCommand(taskId, {
				action: "runPrivate",
				templateId: current.templateId,
				versionId: current.versionId,
				inputFileId: current.inputFileId,
				expectedEstimatedCostT: quoted.estimatedTotalCostT,
				expectedPricingRevision: quoted.pricingRevision,
				confirm: true,
			})
			if (typeof result.runId !== "string" || !result.runId)
				throw new Error("提交结果不确定，请先到 LoomLoom 核对运行记录。")
			update({
				testRunId: result.runId,
				testRunVersionId: current.versionId,
				testRunStatus: String(result.status ?? "accepted"),
			})
			setNotice("私有测试已提交，等待运行完成后检查状态。")
		})
	}

	async function refreshPrivateRun() {
		if (!draft.testRunId) return
		await run("status", async () => {
			const result = await creatorCommand(taskId, {
				action: "privateRunStatus",
				runId: draft.testRunId,
				templateId: draft.templateId,
				versionId: draft.testRunVersionId,
			})
			const info = isObject(result.run) ? result.run : result
			update({
				testRunStatus: typeof info.status === "string" ? info.status : "unknown",
				testCompletedTasks: Number(info.completedTasks ?? 0),
				testTotalTasks: Number(info.totalTasks ?? 0),
				testFailedTasks: Number(info.failedTasks ?? 0),
				testCancelledTasks: Number(info.cancelledTasks ?? 0),
			})
			setNotice(info.status === "completed" ? "私有测试已完成。" : "已更新私有测试状态。")
		})
	}
	useEffect(() => {
		if (readonly || error || !draft.testRunId || ["completed", "failed", "cancelled"].includes(draft.testRunStatus)) return
		const timer = window.setInterval(() => {
			if (!busy) void refreshPrivateRun()
		}, 5_000)
		return () => window.clearInterval(timer)
	}, [taskId, readonly, error, draft.testRunId, draft.testRunVersionId, draft.testRunStatus, busy])

	async function publish() {
		if (!canPublish || !draft.templateId || !draft.versionId) return
		await run("publish", async () => {
			// Re-read authoritative run detail at the publication boundary.
			const status = await creatorCommand(taskId, {
				action: "privateRunStatus",
				runId: draft.testRunId,
				templateId: draft.templateId,
				versionId: draft.versionId,
			})
			const info = isObject(status.run) ? status.run : status
			if (
				info.status !== "completed" ||
				!Number.isSafeInteger(info.totalTasks) ||
				Number(info.totalTasks) <= 0 ||
				Number(info.completedTasks) !== Number(info.totalTasks) ||
				Number(info.failedTasks ?? 0) !== 0 ||
				Number(info.cancelledTasks ?? 0) !== 0
			) {
				throw new Error("此私有版本还没有成功完成的测试运行，暂不能提交市场审核。")
			}
			const result = await creatorCommand(taskId, {
				action: "publish",
				templateId: draft.templateId,
				versionId: draft.versionId,
				displayName: draft.displayName.trim(),
				description: draft.listingDescription.trim(),
				taskFixedFee: { amount: draft.feeAmount.trim(), currency: draft.feeCurrency.trim() },
				...(draft.listingId ? { listingId: draft.listingId } : {}),
				confirm: true,
			})
			update({
				listingId: typeof result.id === "string" ? result.id : draft.listingId,
				reviewRequestId: typeof result.reviewRequestId === "string" ? result.reviewRequestId : "",
				reviewStatus: typeof result.reviewStatus === "string" ? result.reviewStatus : "submitted",
			})
			setNotice("已提交市场审核；审核结果以 LoomLoom 返回为准。")
		})
	}

	async function refreshReview() {
		if (!draft.reviewRequestId) return
		await run("review", async () => {
			const result = (await creatorCommand(taskId, {
				action: "review",
				reviewRequestId: draft.reviewRequestId,
			})) as Review
			update({ reviewStatus: result.status ?? "unknown", listingId: result.listingId ?? draft.listingId })
			setNotice(result.reviewReason ? `审核说明：${result.reviewReason}` : "审核状态已更新。")
		})
	}

	async function loadTemplates() {
		await run("templates", async () => {
			const result = await creatorCommand(taskId, { action: "listTemplates" })
			setTemplates(Array.isArray(result.items) ? (result.items as PrivateTemplate[]) : [])
		})
	}

	async function loadVersions() {
		if (!draft.templateId) return
		await run("versions", async () => {
			const result = await creatorCommand(taskId, { action: "versions", templateId: draft.templateId })
			setVersions(Array.isArray(result.items) ? (result.items as PrivateVersion[]) : [])
		})
	}

	async function loadVersionSpec(templateId: string, versionId: string) {
		if (readonly) return
		await run("versionSpec", async () => {
			const result = await creatorCommand(taskId, { action: "versionSpec", templateId, versionId })
			if (result.specVersion !== "template-spec/v2" || !isObject(result.canonicalSpec)) {
				throw new Error("这个版本不是可编辑的 TemplateSpec v2。")
			}
			const json = JSON.stringify(result.canonicalSpec)
			update({
				mode: "advanced",
				advancedJson: JSON.stringify(result.canonicalSpec, null, 2),
				templateId,
				versionId,
				savedSpecJson: json,
				validatedSpecJson: "",
				inputFileId: "",
				precheck: null,
				testRunId: "",
				testRunStatus: "",
			})
			setNotice("已载入你拥有的私有版本。编辑后需重新校验并另存新版本。")
		})
	}

	async function loadEarnings() {
		await run("earnings", async () => {
			const result = await creatorCommand(taskId, { action: "earnings" })
			setEarnings({
				items: Array.isArray(result.items) ? (result.items as CreatorEarning[]) : [],
				totalAmount: isObject(result.totalAmount) ? (result.totalAmount as Money) : undefined,
				totalCount: typeof result.totalCount === "number" ? result.totalCount : undefined,
			})
		})
	}

	async function handToCline() {
		const current = draftRef.current
		const detail =
			current.mode === "advanced"
				? current.advancedJson
				: [
						`名称：${current.name || "待定"}`,
						`目标：${current.description || "待补充"}`,
						`固定要求：${current.instruction || "待补充"}`,
						`示例输入：${current.samplePrompt || "待补充"}`,
						`当前能力：${current.profileId || "待选择"}`,
						`默认模型：${current.modelId || "待选择"}`,
					].join("\n")
		await run("cline", async () => {
			await onFlushDraft?.()
			await LoomLoomServiceClient.batchTableAction(
				request({
					taskId,
					action: "cite",
					text: `请在当前 Batch 会话帮我继续设计 LoomLoom 私有工作流。我目前的草稿如下，请先讨论方案，不要直接创建、运行或发布：\n\n${detail.slice(0, 14000)}`,
				}),
			)
			setNotice("草稿已放入左侧 Batch 聊天输入框，发送后可和 Cline 继续设计。")
		})
	}

	return (
		<section aria-label="LoomLoom 创造模式" className="creator-workbench">
			<header className="creator-header">
				<div>
					<strong>创造模式</strong>
					<span>设计工作流 → 校验 → 私有测试 → 提交市场审核</span>
				</div>
				{onBack && (
					<button onClick={onBack} type="button">
						返回 Batch 工作表
					</button>
				)}
			</header>
			{readonly && <p className="creator-warning">当前是其他任务或只读视图。切回原 Batch 会话后才能修改和提交。</p>}
			{error && (
				<p className="creator-error" role="alert">
					{error}
				</p>
			)}
			{notice && (
				<p className="creator-notice" role="status">
					{notice}
				</p>
			)}
			<div className="creator-content">
				<div className="creator-topbar">
					<div aria-label="设计方式" className="creator-segment" role="group">
						<button aria-pressed={draft.mode === "simple"} onClick={() => switchMode("simple")} type="button">
							简易设计
						</button>
						<button aria-pressed={draft.mode === "advanced"} onClick={() => switchMode("advanced")} type="button">
							高级 JSON
						</button>
					</div>
					<button disabled={readonly || !!busy} onClick={() => void handToCline()} type="button">
						交给 Cline 继续设计
					</button>
				</div>
				<section className="creator-section">
					<h2>
						<span>1</span> 设计工作流
					</h2>
					{draft.mode === "simple" ? (
						<div className="creator-form">
							<label>
								名称
								<input
									disabled={readonly}
									onChange={(event) => changeDesign({ name: event.target.value })}
									placeholder="如：产品文案改写"
									value={draft.name}
								/>
							</label>
							<label>
								用途说明
								<input
									disabled={readonly}
									onChange={(event) => changeDesign({ description: event.target.value })}
									placeholder="这个工作流会帮助使用者完成什么"
									value={draft.description}
								/>
							</label>
							<label>
								固定要求
								<textarea
									disabled={readonly}
									onChange={(event) => changeDesign({ instruction: event.target.value })}
									placeholder="每次执行都要遵循的要求；未来用户无需重复输入"
									rows={4}
									value={draft.instruction}
								/>
							</label>
							<label>
								一条示例输入
								<textarea
									disabled={readonly}
									onChange={(event) => changeDesign({ samplePrompt: event.target.value })}
									placeholder="用一条真实示例检查工作流；今后每个表格行是一条输入"
									rows={3}
									value={draft.samplePrompt}
								/>
							</label>
							<div className="creator-two-col">
								<label>
									执行能力
									<select
										disabled={readonly || contextState !== "ready"}
										onChange={(event) => {
											const profile = textProfiles.find((item) => item.profileId === event.target.value)
											changeDesign({
												profileId: event.target.value,
												modelId: profile?.eligibleModels?.[0]?.modelId ?? "",
											})
										}}
										value={draft.profileId}>
										<option value="">选择当前可用能力</option>
										{textProfiles.map((profile) => (
											<option key={profile.profileId} value={profile.profileId}>
												{profile.capability || profile.profileId}
											</option>
										))}
									</select>
								</label>
								<label>
									推荐默认模型
									<select
										disabled={readonly || !chosenProfile}
										onChange={(event) => changeDesign({ modelId: event.target.value })}
										value={draft.modelId}>
										<option value="">选择可用模型</option>
										{models.map((model) => (
											<option key={model.modelId} value={model.modelId}>
												{model.displayName || model.modelId}
											</option>
										))}
									</select>
								</label>
							</div>
							<p className="creator-help">
								文本能力和模型来自 LoomLoom 当前服务。用户日后可留空“模型”输入，使用这里选定的默认模型。
							</p>
							{contextState === "error" && (
								<button disabled={!!busy} onClick={() => void loadContext()} type="button">
									重试加载能力
								</button>
							)}
							{contextState === "ready" && textProfiles.length === 0 && (
								<p className="creator-warning">
									当前服务没有适合简易文本工作流的能力。可使用高级 JSON 描述其他工作流，由服务端校验。
								</p>
							)}
						</div>
					) : (
						<div className="creator-form">
							<label>
								TemplateSpec v2 JSON
								<textarea
									className="creator-json"
									disabled={readonly}
									onChange={(event) => changeDesign({ advancedJson: event.target.value })}
									placeholder="在这里粘贴多步骤 TemplateSpec v2"
									rows={18}
									spellCheck={false}
									value={draft.advancedJson}
								/>
							</label>
							<p className="creator-help">
								高级模式可设计多步骤与依赖。此处仅保存草稿；规范与能力绑定以 LoomLoom 服务端校验为准。
							</p>
						</div>
					)}
					{spec.error && <p className="creator-help">{spec.error}</p>}
					<div className="creator-actions">
						<button
							className="creator-primary"
							disabled={readonly || !!busy || !spec.value}
							onClick={() => void validate()}
							type="button">
							{busy === "validate" ? "校验中…" : "校验工作流"}
						</button>
						{validated && <span className="creator-success">✓ 当前草稿已通过服务端校验</span>}
					</div>
				</section>
				<section className="creator-section">
					<h2>
						<span>2</span> 保存为私有工作流
					</h2>
					{draft.templateId ? (
						<p>
							私有模板：<code>{draft.templateId}</code>
							{draft.versionId && (
								<>
									{" "}
									· 当前保存版本：<code>{draft.versionId}</code>
								</>
							)}
						</p>
					) : (
						<p className="creator-help">先创建私有容器，再把已校验的内容保存为不可变版本。创建后不会自动上架。</p>
					)}
					<div className="creator-actions">
						{!draft.templateId && (
							<button
								disabled={readonly || !!busy || !validated}
								onClick={() => setConfirm("create")}
								type="button">
								创建私有模板
							</button>
						)}
						{draft.templateId && (
							<button
								disabled={readonly || !!busy || !validated || saved}
								onClick={() => setConfirm("version")}
								type="button">
								保存新版本
							</button>
						)}
						<button disabled={!!busy} onClick={() => void loadTemplates()} type="button">
							我的私有模板
						</button>
						{draft.templateId && (
							<button disabled={!!busy} onClick={() => void loadVersions()} type="button">
								查看版本
							</button>
						)}
					</div>
					{confirm === "create" && (
						<div aria-label="确认创建私有模板" className="creator-confirm" role="group">
							<span>将创建“{specName}”的私有模板容器；尚不运行或发布。</span>
							<button
								className="creator-primary"
								disabled={readonly || !!busy || !validated}
								onClick={() => void createTemplate()}
								type="button">
								确认创建
							</button>
							<button onClick={() => setConfirm("")} type="button">
								取消
							</button>
						</div>
					)}
					{confirm === "version" && (
						<div aria-label="确认保存版本" className="creator-confirm" role="group">
							<span>将当前校验通过的设计保存为 {draft.templateId} 的新不可变版本。</span>
							<button
								className="creator-primary"
								disabled={readonly || !!busy || !validated}
								onClick={() => void saveVersion()}
								type="button">
								确认保存版本
							</button>
							<button onClick={() => setConfirm("")} type="button">
								取消
							</button>
						</div>
					)}
					{versions.length > 0 && (
						<div aria-label="私有版本" className="creator-records">
							{versions.map((item) => (
								<div key={item.versionId}>
									<span>
										版本 {item.versionNumber ?? "—"} · <small>{item.versionId}</small>
									</span>
								</div>
							))}
						</div>
					)}
					{templates.length > 0 && (
						<div aria-label="我的私有模板" className="creator-records">
							{templates.map((item) => (
								<div key={item.templateId}>
									<span>
										{item.name} <small>{item.templateId}</small>
									</span>
									<button
										disabled={readonly || !!busy}
										onClick={() => {
											changeDesign({
												templateId: item.templateId,
												name: item.name,
												versionId: "",
												savedSpecJson: "",
												testRunId: "",
												testRunStatus: "",
											})
											setVersions([])
										}}
										type="button">
										关联当前草稿
									</button>
									{item.latestVersionId && (
										<button
											disabled={readonly || !!busy}
											onClick={() => void loadVersionSpec(item.templateId, item.latestVersionId!)}
											type="button">
											载入最新版本
										</button>
									)}
								</div>
							))}
						</div>
					)}
					{versions.length > 0 && (
						<div aria-label="私有版本" className="creator-records">
							{versions.map((item) => (
								<div key={item.versionId}>
									<span>
										版本 {item.versionNumber ?? "—"} · <small>{item.versionId}</small>
									</span>
									<button
										disabled={readonly || !!busy}
										onClick={() => void loadVersionSpec(draft.templateId, item.versionId)}
										type="button">
										载入设计
									</button>
								</div>
							))}
						</div>
					)}
					{versions.length > 0 && (
						<div aria-label="私有版本" className="creator-records">
							{versions.map((item) => (
								<div key={item.versionId}>
									<span>
										版本 {item.versionNumber ?? "—"} · <small>{item.versionId}</small>
									</span>
								</div>
							))}
						</div>
					)}
				</section>
				<section className="creator-section">
					<h2>
						<span>3</span> 私有测试
					</h2>
					<p className="creator-help">
						市场发布要求这个私有版本至少成功运行一次。示例输入先上传并获取费用预算，测试运行会产生模型费用。
					</p>
					<div className="creator-actions">
						<button
							disabled={
								readonly ||
								!!busy ||
								!saved ||
								(draft.testSubmissionUnknown && !draft.testRunId) ||
								(!!draft.testRunId && !["completed", "failed", "cancelled"].includes(draft.testRunStatus))
							}
							onClick={() => void precheckTest()}
							type="button">
							用示例输入查看测试预算
						</button>
					</div>
					{draft.precheck && saved && (
						<div className="creator-quote">
							<div>
								测试版本 <code>{draft.versionId}</code>
							</div>
							<div>任务数：1</div>
							<div>
								预计费用：
								<strong>
									{draft.precheck.estimatedTotalCost?.amount ?? "未返回"}{" "}
									{draft.precheck.estimatedTotalCost?.currency ?? "货币未知"}
								</strong>
							</div>
							{draft.precheck.balanceCheck?.availableBalanceMoney && (
								<div>
									可用余额：{draft.precheck.balanceCheck.availableBalanceMoney.amount}{" "}
									{draft.precheck.balanceCheck.availableBalanceMoney.currency}
								</div>
							)}
							{draft.precheck.balanceCheck?.isSufficient === false && (
								<p className="creator-error">余额不足，无法运行。</p>
							)}
							<button
								disabled={
									readonly ||
									!!busy ||
									draft.precheck.balanceCheck?.isSufficient === false ||
									draft.testSubmissionUnknown ||
									!draft.precheck.estimatedTotalCost?.currency
								}
								onClick={() => setConfirm("run")}
								type="button">
								确认测试费用
							</button>
						</div>
					)}
					{confirm === "run" && draft.precheck && (
						<div aria-label="确认付费私有测试" className="creator-confirm" role="group">
							<span>
								将用 1 条示例输入运行私有版本 {draft.versionId}；预计费用{" "}
								{draft.precheck.estimatedTotalCost?.amount} {draft.precheck.estimatedTotalCost?.currency}
								，实际以服务端结算为准。
							</span>
							<button
								className="creator-primary"
								disabled={readonly || !!busy || !saved || draft.testSubmissionUnknown}
								onClick={() => void runPrivateTest()}
								type="button">
								确认并运行测试
							</button>
							<button onClick={() => setConfirm("")} type="button">
								取消
							</button>
						</div>
					)}
					{draft.testSubmissionUnknown && !draft.testRunId && (
						<p className="creator-warning">测试提交结果不确定。请先核对 LoomLoom 运行记录，避免重复付费。</p>
					)}
					{draft.testRunId && (
						<div className="creator-run">
							<span>
								测试运行 <code>{draft.testRunId}</code> · {draft.testRunStatus || "状态待查"} · 完成{" "}
								{draft.testCompletedTasks}/{draft.testTotalTasks}
							</span>
							<button disabled={!!busy} onClick={() => void refreshPrivateRun()} type="button">
								刷新测试状态
							</button>
						</div>
					)}
					{testPassed && <p className="creator-success">✓ 当前私有版本已有成功的测试运行</p>}
				</section>
				<section className="creator-section">
					<h2>
						<span>4</span> 提交市场审核
					</h2>
					<p className="creator-help">
						发布的是已保存、已测试的私有版本；市场 Listing 是单独的售卖对象。审核通过后才可作为 SkillBot
						被用户发现和购买。填写的是创作者每任务固定费，买家运行时还会按实际模型/API 用量结算。
					</p>
					<div className="creator-form creator-two-col">
						<label>
							市场名称
							<input
								disabled={readonly}
								onChange={(event) => update({ displayName: event.target.value })}
								placeholder="买家看到的名称"
								value={draft.displayName}
							/>
						</label>
						<label>
							每任务固定费用
							<input
								disabled={readonly}
								inputMode="decimal"
								onChange={(event) => update({ feeAmount: event.target.value })}
								placeholder="如 1.00"
								value={draft.feeAmount}
							/>
						</label>
						<label>
							货币
							<input
								disabled={readonly}
								onChange={(event) => update({ feeCurrency: event.target.value.toUpperCase() })}
								placeholder="如 CNY"
								value={draft.feeCurrency}
							/>
						</label>
						<label>
							市场介绍
							<input
								disabled={readonly}
								onChange={(event) => update({ listingDescription: event.target.value })}
								placeholder="说明买家能得到什么"
								value={draft.listingDescription}
							/>
						</label>
					</div>
					<div className="creator-actions">
						<button
							disabled={!canPublish || !!draft.reviewRequestId}
							onClick={() => setConfirm("publish")}
							type="button">
							提交市场审核
						</button>
						{!testPassed && <span className="creator-help">先保存当前版本并确认私有测试成功</span>}
					</div>
					{draft.feeAmount && !validFee && (
						<p className="creator-help">费用填写普通金额，最多 7 位小数；货币填写三个大写字母，例如 CNY。</p>
					)}
					{confirm === "publish" && (
						<div aria-label="确认市场发布" className="creator-confirm" role="group">
							<span>
								提交“{draft.displayName}”，版本 {draft.versionId}，向买家收取每任务 {draft.feeAmount}{" "}
								{draft.feeCurrency} 固定费用（模型/API 成本另计）；将进入市场审核，并非立即上架。
							</span>
							<button
								className="creator-primary"
								disabled={!canPublish}
								onClick={() => void publish()}
								type="button">
								确认提交审核
							</button>
							<button onClick={() => setConfirm("")} type="button">
								取消
							</button>
						</div>
					)}
					{draft.reviewRequestId && (
						<div className="creator-run">
							<span>
								审核申请 <code>{draft.reviewRequestId}</code> · {draft.reviewStatus || "状态待查"}
								{draft.listingId && (
									<>
										{" "}
										· Listing <code>{draft.listingId}</code>
									</>
								)}
							</span>
							<button disabled={!!busy} onClick={() => void refreshReview()} type="button">
								刷新审核状态
							</button>
						</div>
					)}
					<div className="creator-actions">
						<button disabled={!!busy} onClick={() => void loadEarnings()} type="button">
							查看我的创作者收益
						</button>
					</div>
					{earnings && (
						<div aria-label="账号创作者收益" className="creator-records">
							<div>
								<span>
									账号全部市场收益 · {earnings.totalCount ?? earnings.items.length} 笔
									{earnings.totalAmount && (
										<>
											{" "}
											· {earnings.totalAmount.amount} {earnings.totalAmount.currency}
										</>
									)}
								</span>
							</div>
							{earnings.items.slice(0, 5).map((item, index) => (
								<div key={item.id ?? index}>
									<span>
										{item.amount ? `${item.amount.amount} ${item.amount.currency}` : "金额未返回"} ·{" "}
										{item.incomePostStatus ?? "状态未知"}
									</span>
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		</section>
	)
}
