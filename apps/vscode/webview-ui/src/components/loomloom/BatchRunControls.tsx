import { type BatchChatSnapshot, type BatchCommand, effectiveTaskCount } from "@shared/loomloom"
import { useEffect, useState } from "react"
import { formatBatchAmount } from "./batch-format"
import { getBatchGuidance, isBatchQuoteCurrent } from "./batch-guidance"

/** Human controls shared by chat and the worksheet; both use the same task command endpoint. */
export function BatchRunControls({
	session,
	disabled = false,
	showGuidance = false,
	variant = "chat",
	onCommand,
}: {
	session: BatchChatSnapshot
	disabled?: boolean
	showGuidance?: boolean
	variant?: "chat" | "worksheet"
	onCommand: (command: BatchCommand) => Promise<unknown>
}) {
	const [now, setNow] = useState(Date.now)
	const [runId, setRunId] = useState("")
	useEffect(() => {
		setNow(Date.now())
		if (!session.quote?.valid) return
		const timer = setTimeout(() => setNow(Date.now()), Math.max(0, session.quote.at + 10 * 60_000 + 1 - Date.now()))
		return () => clearTimeout(timer)
	}, [session.quote?.id, session.quote?.at, session.quote?.valid])
	// newBatch keeps the BatchSession id; a recovery ID from an earlier attempt
	// must never be offered as the default for a later ambiguous submission.
	useEffect(() => setRunId(""), [session.id, session.attempt?.requestId])
	if (!session.enabled) return null
	const blocked = disabled || !!session.pendingWorksheetEdit
	const currentQuote = isBatchQuoteCurrent(session, now)
	const guidance = getBatchGuidance(session, now)
	const action = (command: BatchCommand) => void onCommand(command)
	if (variant === "worksheet") {
		const taskCount = effectiveTaskCount(session.rows)
		const quote = session.quote
		const isFinished = ["completed", "partial-failure", "failed"].includes(session.phase)
		const canReview = session.phase === "collecting" || session.phase === "quantity"
		const step =
			session.phase === "reviewing" || session.phase === "quoting"
				? "2/3 · 查看预算"
				: session.phase === "quoted"
					? currentQuote
						? "3/3 · 确认运行"
						: "预算需更新"
					: canReview
						? taskCount > 0
							? "1/3 · 检查输入"
							: "待填写"
						: session.phase === "selecting"
							? "选择工作流"
							: isFinished
								? "本批已结束"
								: "运行状态"
		return (
			<section aria-label="批处理下一步" aria-live="polite" className="bw-stage-bar">
				<div className="bw-stage-main">
					<div className="bw-stage-heading">
						<span className="bw-stage-step">{step}</span>
						<strong className="bw-stage-workflow">{session.listing?.name ?? guidance.title}</strong>
						<span>{taskCount} 条任务</span>
						{quote && !session.attempt && session.phase === "quoted" && (
							<strong className={currentQuote ? "bw-stage-amount" : "bw-stage-stale"}>
								{currentQuote ? "预计应付" : "旧预算已失效"} {formatBatchAmount(quote.payable.amount)}{" "}
								{quote.payable.currency}
							</strong>
						)}
					</div>
					<p>{session.pendingWorksheetEdit ? "工作表有尚未保存的编辑，请先保存或放弃草稿。" : guidance.nextStep}</p>
					{quote && !session.attempt && session.phase === "quoted" && (
						<small>确认后创建云端任务，最终费用以服务端结算为准。</small>
					)}
				</div>
				<div className="bw-stage-actions">
					{canReview && (
						<button
							className="bw-stage-primary"
							disabled={blocked || taskCount === 0}
							onClick={() => action({ action: "review", revision: session.revision })}
							type="button">
							检查输入
						</button>
					)}
					{session.phase === "reviewing" && (
						<button
							className="bw-stage-primary"
							disabled={blocked}
							onClick={() => action({ action: "quote", revision: session.revision })}
							type="button">
							确认输入并查看预算
						</button>
					)}
					{session.phase === "quoting" && (
						<button className="bw-stage-primary" disabled type="button">
							正在获取预算…
						</button>
					)}
					{session.phase === "quoted" && !session.attempt && (
						<>
							<button
								className={currentQuote ? undefined : "bw-stage-primary"}
								disabled={blocked}
								onClick={() => action({ action: "revise", revision: session.revision })}
								type="button">
								返回修改
							</button>
							{currentQuote && quote && (
								<button
									className="bw-stage-primary"
									disabled={blocked}
									onClick={() => action({ action: "execute", revision: session.revision, quoteId: quote.id })}
									type="button">
									确认并运行
								</button>
							)}
						</>
					)}
					{session.phase === "submitting" && (
						<button className="bw-stage-primary" disabled type="button">
							正在提交…
						</button>
					)}
					{session.phase === "running" && (
						<button disabled type="button">
							运行中
						</button>
					)}
					{session.phase === "execution-unknown" && (
						<>
							<input
								aria-label="核对后的运行 ID"
								disabled={blocked}
								onChange={(event) => setRunId(event.target.value)}
								placeholder="核对后的运行 ID"
								value={runId}
							/>
							<button
								className="bw-stage-primary"
								disabled={blocked || !runId.trim()}
								onClick={() => action({ action: "recoverRun", runId: runId.trim() })}
								type="button">
								关联已核对的运行
							</button>
						</>
					)}
					{isFinished && (
						<>
							{session.listing && (
								<button
									disabled={blocked}
									onClick={() => action({ action: "newBatch", revision: session.revision, keepListing: false })}
									type="button">
									改用其他 SkillBot
								</button>
							)}
							<button
								className="bw-stage-primary"
								disabled={blocked}
								onClick={() => action({ action: "newBatch", revision: session.revision })}
								type="button">
								{session.listing ? "沿用此 SkillBot 开始下一批" : "开始新一批"}
							</button>
						</>
					)}
				</div>
			</section>
		)
	}
	return (
		<section aria-label="批处理操作" className="batch-ui batch-run-controls">
			{session.pendingWorksheetEdit && (
				<p role="status">Batch 工作表中有尚未保存的编辑，请先保存或放弃草稿，再检查、报价或运行。</p>
			)}
			{showGuidance && (
				<div aria-live="polite" className="batch-run-guidance">
					<strong>{guidance.title}</strong>
					<span>{guidance.nextStep}</span>
				</div>
			)}
			{!session.attempt && effectiveTaskCount(session.rows) > 0 && session.phase === "collecting" && (
				<button
					className="primary"
					disabled={blocked}
					onClick={() => action({ action: "review", revision: session.revision })}>
					检查输入
				</button>
			)}
			{!session.attempt && session.phase === "reviewing" && (
				<button
					className="primary"
					disabled={blocked}
					onClick={() => action({ action: "quote", revision: session.revision })}>
					确认输入并查看预算
				</button>
			)}
			{session.phase === "quoting" && <p role="status">正在获取预算，请稍候…</p>}
			{session.quote && !session.attempt && (
				<section className={"batch-quote " + (currentQuote ? "" : "stale")}>
					<strong>{currentQuote ? "运行前确认" : "旧预算已失效"}</strong>
					<p>
						{session.quote.taskCount} 个任务 · 预计应付 {formatBatchAmount(session.quote.payable.amount)}{" "}
						{session.quote.payable.currency}
					</p>
					<small>确认后创建云端任务，最终费用以服务端结算为准。</small>
					{session.phase === "quoted" && (
						<div className="batch-actions">
							<button disabled={blocked} onClick={() => action({ action: "revise", revision: session.revision })}>
								返回修改
							</button>
							{currentQuote && (
								<button
									className="primary"
									disabled={blocked}
									onClick={() =>
										action({ action: "execute", revision: session.revision, quoteId: session.quote!.id })
									}>
									确认并运行
								</button>
							)}
						</div>
					)}
				</section>
			)}
			{session.phase === "submitting" && <p role="status">正在提交生成任务，请勿重复操作…</p>}
			{session.phase === "execution-unknown" && (
				<div className="batch-actions">
					<input
						aria-label="核对后的运行 ID"
						disabled={blocked}
						onChange={(e) => setRunId(e.target.value)}
						value={runId}
					/>
					<button
						disabled={blocked || !runId.trim()}
						onClick={() => action({ action: "recoverRun", runId: runId.trim() })}>
						关联已核对的运行
					</button>
				</div>
			)}
			{["completed", "partial-failure", "failed"].includes(session.phase) && (
				<div className="batch-actions">
					<button
						className="primary"
						disabled={blocked}
						onClick={() => action({ action: "newBatch", revision: session.revision })}>
						{session.listing ? `沿用「${session.listing.name}」开始下一批` : "开始新一批"}
					</button>
					{session.listing && (
						<button
							disabled={blocked}
							onClick={() => action({ action: "newBatch", revision: session.revision, keepListing: false })}>
							改用其他 SkillBot
						</button>
					)}
				</div>
			)}
		</section>
	)
}
