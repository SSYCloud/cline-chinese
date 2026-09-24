import type { BatchChatSnapshot, BatchCommand } from "@shared/loomloom"
import { useEffect, useState } from "react"
import { formatBatchAmount } from "./batch-format"
import { getBatchGuidance, isBatchQuoteCurrent } from "./batch-guidance"

/** Human controls shared by chat and the worksheet; both use the same task command endpoint. */
export function BatchRunControls({
	session,
	disabled = false,
	showGuidance = false,
	onCommand,
}: {
	session: BatchChatSnapshot
	disabled?: boolean
	showGuidance?: boolean
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
	useEffect(() => setRunId(""), [session.id])
	if (!session.enabled) return null
	const currentQuote = isBatchQuoteCurrent(session, now)
	const guidance = getBatchGuidance(session, now)
	const action = (command: BatchCommand) => void onCommand(command)
	return (
		<section aria-label="批处理操作" className="batch-ui batch-run-controls">
			{showGuidance && (
				<div aria-live="polite" className="batch-run-guidance">
					<strong>{guidance.title}</strong>
					<span>{guidance.nextStep}</span>
				</div>
			)}
			{!session.attempt && session.rows.length > 0 && session.phase === "collecting" && (
				<button
					className="primary"
					disabled={disabled}
					onClick={() => action({ action: "review", revision: session.revision })}>
					检查输入
				</button>
			)}
			{!session.attempt && session.phase === "reviewing" && (
				<button
					className="primary"
					disabled={disabled}
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
							<button disabled={disabled} onClick={() => action({ action: "revise", revision: session.revision })}>
								返回修改
							</button>
							{currentQuote && (
								<button
									className="primary"
									disabled={disabled}
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
						disabled={disabled}
						onChange={(e) => setRunId(e.target.value)}
						value={runId}
					/>
					<button
						disabled={disabled || !runId.trim()}
						onClick={() => action({ action: "recoverRun", runId: runId.trim() })}>
						关联已核对的运行
					</button>
				</div>
			)}
			{["completed", "partial-failure", "failed"].includes(session.phase) && (
				<div className="batch-actions">
					<button
						className="primary"
						disabled={disabled}
						onClick={() => action({ action: "newBatch", revision: session.revision })}>
						{session.listing ? `沿用「${session.listing.name}」开始下一批` : "开始新一批"}
					</button>
					{session.listing && (
						<button
							disabled={disabled}
							onClick={() => action({ action: "newBatch", revision: session.revision, keepListing: false })}>
							改用其他 SkillBot
						</button>
					)}
				</div>
			)}
		</section>
	)
}
