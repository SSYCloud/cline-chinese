import type { BatchChatSnapshot, BatchCommand } from "@shared/loomloom"
import { statusLabel } from "@shared/loomloom-sheet"
import { StringRequest } from "@shared/proto/cline/common"
import { memo, useContext, useEffect, useState } from "react"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { useSignIn as useShengSuanYunSignIn } from "@/context/ShengSuanYunAuthContext"
import { LoomLoomServiceClient } from "@/services/grpc-client"
import { BatchRowEditor } from "./BatchFieldEditor"
import { BatchRunControls } from "./BatchRunControls"
import { sendBatch } from "./batch-api"
import { getBatchGuidance } from "./batch-guidance"
import { SkillBotMarket } from "./SkillBotMarket"
import "./batch.css"

export const BatchConversation = memo(function BatchConversation({
	session,
	onChat,
	onMarket,
	showEvents = true,
}: {
	session: BatchChatSnapshot
	onChat: (text: string, files: string[]) => Promise<void>
	onMarket: () => void
	showEvents?: boolean
}) {
	const [edit, setEdit] = useState<string | null>(null)
	const [useExistingKey, setUseExistingKey] = useState(false)
	const authState = useContext(ExtensionStateContext)
	const { isLoginLoading, handleSignIn } = useShengSuanYunSignIn()
	const showLoginPrompt =
		session.enabled &&
		session.phase === "selecting" &&
		!session.listing &&
		authState?.loomLoomSignedIn === false &&
		!useExistingKey
	useEffect(() => setUseExistingKey(false), [session.taskId, authState?.loomLoomSignedIn])
	const [error, setError] = useState(""),
		[busy, setBusy] = useState(false)
	const readonly = !!session.attempt || session.phase === "quoting" || !session.enabled
	const index = session.rows.findIndex((row) => row.id === edit)
	const [pendingNext, setPendingNext] = useState<{ id: string; revision: number } | null>(null)
	const [resetRevision, setResetRevision] = useState<number | null>(null)
	const [now, setNow] = useState(Date.now)
	useEffect(() => {
		setNow(Date.now())
		if (!session.quote?.valid) return
		const expiresAt = session.quote.at + 10 * 60_000 + 1
		const timer = setTimeout(() => setNow(Date.now()), Math.max(0, expiresAt - Date.now()))
		return () => clearTimeout(timer)
	}, [session.quote?.id, session.quote?.at, session.quote?.valid])
	const guidance = getBatchGuidance(session, now)
	useEffect(() => {
		if (pendingNext && session.revision >= pendingNext.revision) {
			setEdit(pendingNext.id)
			setPendingNext(null)
		}
	}, [pendingNext, session.revision])
	async function perform(fn: () => Promise<unknown>) {
		setBusy(true)
		setError("")
		try {
			await fn()
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setBusy(false)
		}
	}
	const action = (command: BatchCommand) => perform(() => sendBatch(command, session.taskId))
	const openSheet = () =>
		perform(() =>
			LoomLoomServiceClient.openBatchTable(StringRequest.create({ value: JSON.stringify({ taskId: session.taskId }) })),
		)
	const p = session.progress
	const ended = p ? p.completed + p.failed + (p.cancelled ?? 0) : 0
	return (
		<article aria-label="Cline Batch 工作流" className="batch-ui batch-turn batch-conversation">
			<header className="batch-assistant-header">
				<span aria-hidden="true" className="batch-assistant-mark">
					›_
				</span>
				<strong>Cline Chinese</strong>
			</header>
			{showLoginPrompt ? (
				<section aria-label="登录胜算云使用 Batch" className="batch-entry-auth">
					<p>登录胜算云后，可浏览并安装 SkillBot 市场中的工作流。</p>
					<p>你也可以创作自己的 SkillBot，申请发布到市场；审核通过后可收费获益。</p>
					<div className="batch-actions">
						<button className="primary" disabled={isLoginLoading} onClick={handleSignIn} type="button">
							{isLoginLoading ? "正在打开登录页面…" : "登录胜算云"}
						</button>
						{authState?.loomLoomCredentialAvailable && (
							<button onClick={() => setUseExistingKey(true)} type="button">
								使用现有 API Key
							</button>
						)}
					</div>
					<small>完成登录后会显示已安装工作流，也可进入市场浏览更多 SkillBot。</small>
				</section>
			) : (
				<div aria-live="polite" className="batch-guidance">
					<p>{guidance.message}</p>
					<p>{guidance.nextStep}</p>
				</div>
			)}
			{session.enabled && !showLoginPrompt && (
				<>
					{session.phase === "selecting" && (
						<>
							<SkillBotMarket
								installedOnly
								onMarket={onMarket}
								onSelect={(item) => void action({ action: "select", listingId: item.id })}
							/>
						</>
					)}
					{session.listing && (
						<section className="batch-sheet-summary">
							<p className="batch-current-workflow">
								当前 SkillBot：<strong>{session.listing.name}</strong> · {session.rows.length} 行输入
							</p>
							{session.outputDestination && (
								<details className="batch-output-location">
									<summary>文本产物自动保存到工作区</summary>
									<small>
										{session.outputDestination.baseDirectory}
										/.cline/loomloom-outputs/（按批次、任务分目录，不覆盖源码）
									</small>
								</details>
							)}
							<button className="batch-link" disabled={busy} onClick={() => void openSheet()}>
								打开 Batch 工作表
							</button>
							{!readonly && (
								<div className="batch-actions">
									<button
										className="batch-link"
										disabled={busy || session.rows.length >= 100}
										onClick={() => void action({ action: "addRows", count: 1, revision: session.revision })}>
										+ 新增一行
									</button>
									<button
										className="batch-link"
										disabled={busy || session.rows.length === 0}
										onClick={() =>
											void perform(() =>
												onChat(
													"请根据当前 SkillBot 的输入要求，结合对话和文件帮我整理 Batch 工作表。需要几条就新增几行，缺少的信息请逐条问我；完成后由我检查输入和预算。",
													session.rows.flatMap((r) => r.attachments.map((a) => a.path)),
												),
											)
										}>
										在聊天中整理
									</button>
									<button
										className="batch-link"
										disabled={busy || session.rows.length === 0}
										onClick={() => setEdit(session.rows[0].id)}>
										逐条填写 {session.rows.length} 条
									</button>
								</div>
							)}
							{index >= 0 && !readonly && (
								<BatchRowEditor
									close={() => setEdit(null)}
									index={index}
									key={edit}
									row={session.rows[index]}
									saved={(next, revision) => {
										setEdit(null)
										if (next) setPendingNext({ id: session.rows[index + 1].id, revision })
									}}
									session={session}
								/>
							)}
						</section>
					)}
					<BatchRunControls disabled={busy || edit !== null} onCommand={action} session={session} />
					{session.attempt?.runId && (
						<section aria-label="批量运行进度" aria-live="polite">
							<p>
								{p
									? statusLabel(p.status) +
										" · 成功 " +
										p.completed +
										"/" +
										p.total +
										" · 失败 " +
										p.failed +
										" · 取消 " +
										(p.cancelled ?? 0)
									: "已提交，正在同步进度…"}
							</p>
							{p && (
								<progress
									aria-label="已结束的任务"
									max={Math.max(1, p.total)}
									style={{ width: "100%" }}
									value={Math.min(ended, p.total)}
								/>
							)}
							<small>逐行状态、错误详情及长内容请在工作表中查看。</small>
							<div className="batch-actions">
								<button disabled={busy} onClick={() => void action({ action: "refreshRun" })}>
									刷新状态
								</button>
							</div>
						</section>
					)}
					{session.listing && !session.attempt && session.phase !== "quoting" && (
						<div className="batch-actions">
							<button className="batch-link" disabled={busy} onClick={() => setResetRevision(session.revision)}>
								重新选择工作流
							</button>
						</div>
					)}
					{resetRevision !== null && !session.attempt && (
						<section aria-label="重新选择工作流确认" className="batch-editor" role="dialog">
							<p>
								重新选择会清空本次 {session.rows.length}{" "}
								条未提交输入及附件关联。附件原文件和已运行历史不会删除；需要保留的输入可先从工作表复制。
							</p>
							{resetRevision !== session.revision && <p role="alert">确认期间输入发生了变化，请取消后重新核对。</p>}
							<div className="batch-actions">
								<button disabled={busy} onClick={() => setResetRevision(null)}>
									保留当前输入
								</button>
								<button
									disabled={busy || resetRevision !== session.revision}
									onClick={() =>
										void perform(async () => {
											await sendBatch(
												{ action: "newBatch", revision: resetRevision, keepListing: false },
												session.taskId,
											)
											setResetRevision(null)
											setEdit(null)
										})
									}>
									确认清空并重新选择
								</button>
							</div>
						</section>
					)}
				</>
			)}
			{!!session.pastRunCount && (
				<button disabled={busy} onClick={() => void openSheet()}>
					查看 {session.pastRunCount} 个历史批次
				</button>
			)}
			{session.outputSummary && (session.outputSummary.saved > 0 || session.outputSummary.failed > 0) && (
				<section aria-label="本地文件保存状态">
					<p>
						已保存 {session.outputSummary.saved} 个文本文件
						{session.outputSummary.failed
							? `；${session.outputSummary.failed} 个本地保存失败，云端结果仍保留。`
							: "，可在工作表中打开。"}
					</p>
					{session.outputSummary.failed > 0 && (
						<button
							disabled={busy}
							onClick={() =>
								void perform(() =>
									LoomLoomServiceClient.batchTableAction(
										StringRequest.create({
											value: JSON.stringify({
												taskId: session.taskId,
												action: "saveOutputs",
												runId: session.attempt?.runId,
											}),
										}),
									),
								)
							}>
							重试保存文件
						</button>
					)}
				</section>
			)}
			{(error || session.error) && <p role="alert">{error || session.error}</p>}
			{showEvents && session.events.length > 0 && (
				<details className="batch-events">
					<summary>查看工作流记录</summary>
					{session.events.map((event) => (
						<p key={event.id}>{event.text}</p>
					))}
				</details>
			)}
		</article>
	)
})
