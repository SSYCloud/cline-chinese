import type { SkillBot } from "@shared/loomloom"
import { useContext, useEffect, useState } from "react"
import { ExtensionStateContext } from "@/context/ExtensionStateContext"
import { useSignIn as useShengSuanYunSignIn } from "@/context/ShengSuanYunAuthContext"
import { fetchSkillBots, type SkillBotPage } from "./batch-api"
import { formatBatchAmount } from "./batch-format"
import "./batch.css"

export function SkillBotMarket({
	installedOnly = false,
	onSelect,
	onMarket,
}: {
	installedOnly?: boolean
	onSelect?: (item: SkillBot) => void
	onMarket?: () => void
}) {
	const [installed, setInstalled] = useState(installedOnly)
	const [page, setPage] = useState(0)
	const [tokens, setTokens] = useState([""])
	const [keyword, setKeyword] = useState("")
	const [data, setData] = useState<SkillBotPage>({ items: [], installedIds: [] })
	const [error, setError] = useState("")
	const [loading, setLoading] = useState(false)
	const [refresh, setRefresh] = useState(0)
	// The existing auth callback posts a fresh ExtensionState. Watch only the
	// credential's availability, not generic userInfo (which other auth can set).
	const credentialAvailable = useContext(ExtensionStateContext)?.loomLoomCredentialAvailable
	const { isLoginLoading, handleSignIn } = useShengSuanYunSignIn()
	useEffect(() => {
		let cancelled = false
		setLoading(true)
		const timer = setTimeout(
			() => {
				fetchSkillBots({ installed, page, pageToken: tokens[page] || "", keyword })
					.then((result) => {
						if (!cancelled) {
							setData(result)
							setError("")
						}
					})
					.catch((e) => {
						if (!cancelled) setError(String(e.message || e))
					})
					.finally(() => {
						if (!cancelled) setLoading(false)
					})
			},
			keyword ? 300 : 0,
		)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [installed, page, tokens, keyword, refresh, credentialAvailable])
	async function pin(item: SkillBot, use = false) {
		setLoading(true)
		try {
			await fetchSkillBots({ action: "pin", id: item.id, installed: true })
			setRefresh((n) => n + 1)
			if (use) onSelect?.(item)
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e))
		} finally {
			setLoading(false)
		}
	}
	const authRequired = installed && data.authRequired
	return (
		<section aria-label="LoomLoom SkillBot 市场" className="batch-ui">
			{!installedOnly && (
				<>
					<div className="batch-actions">
						<button
							onClick={() => {
								setInstalled(true)
								setPage(0)
							}}>
							已安装
						</button>
						<button
							onClick={() => {
								setInstalled(false)
								setPage(0)
								setTokens([""])
							}}>
							市场
						</button>
					</div>
					{!installed && (
						<input
							aria-label="搜索 SkillBot"
							onChange={(e) => {
								setKeyword(e.target.value)
								setPage(0)
								setTokens([""])
							}}
							placeholder="搜索 LoomLoom SkillBot"
							value={keyword}
						/>
					)}
				</>
			)}
			{error && (
				<p role="alert">
					{error}{" "}
					<button
						onClick={() => {
							setPage(0)
							setTokens([""])
							setRefresh((n) => n + 1)
						}}>
						重试
					</button>
				</p>
			)}
			{loading && <p role="status">正在加载 SkillBot…</p>}
			{!loading && authRequired && (
				<div className="batch-auth-guide">
					<p>使用 LoomLoom Batch 前，请先登录胜算云。登录后可在当前 Cline 对话中继续选择 SkillBot。</p>
					<div className="batch-actions">
						<button className="primary" disabled={isLoginLoading} onClick={handleSignIn} type="button">
							{isLoginLoading ? "正在打开登录页面…" : "登录胜算云"}
						</button>
						<button disabled={isLoginLoading} onClick={() => setRefresh((n) => n + 1)} type="button">
							已完成登录，刷新工作流
						</button>
					</div>
				</div>
			)}
			{!loading && !error && !authRequired && !data.items.length && (
				<p>{installed ? "暂无已安装的工作流，请前往市场选择。" : "暂无符合条件的 SkillBot。"}</p>
			)}
			{!authRequired && (
				<div className="batch-catalog">
					{data.items.map((item) => {
						const pinned = data.installedIds.includes(item.id)
						const available = item.availability.toLowerCase() === "available"
						return (
							<div className="batch-catalog-row" key={item.id}>
								<div>
									<strong>{item.name}</strong>
									<p>{item.description}</p>
									<small>
										{pinned ? "已安装" : "SkillBot"}
										{item.fee ? ` · ${formatBatchAmount(item.fee.amount)} ${item.fee.currency} / 任务` : ""}
										{!available ? " · 暂不可用" : ""}
									</small>
								</div>
								<div className="batch-actions">
									{onSelect && (
										<button
											className="primary"
											disabled={loading || !available}
											onClick={() => (pinned ? onSelect(item) : void pin(item, true))}>
											{pinned ? "选择" : "安装并使用"}
										</button>
									)}
									{!onSelect && !pinned && (
										<button disabled={loading || !available} onClick={() => void pin(item)}>
											安装
										</button>
									)}
									{pinned && (
										<button
											aria-label={`移除 ${item.name}`}
											disabled={loading}
											onClick={() => {
												void fetchSkillBots({ action: "unpin", id: item.id, installed: true })
													.then(() => {
														setPage(0)
														setRefresh((n) => n + 1)
													})
													.catch((e) => setError(String(e.message || e)))
											}}>
											移除
										</button>
									)}
								</div>
							</div>
						)
					})}
				</div>
			)}
			{!authRequired && (
				<div className="batch-actions">
					<button disabled={page === 0 || loading} onClick={() => setPage((n) => n - 1)}>
						上一页
					</button>
					<span>
						{page + 1}
						{installed ? ` / ${data.pages || 1}` : ""}
					</span>
					<button
						disabled={loading || (installed ? page + 1 >= (data.pages || 1) : !data.nextPageToken)}
						onClick={() => {
							if (!installed) setTokens((old) => [...old.slice(0, page + 1), data.nextPageToken!])
							setPage((n) => n + 1)
						}}>
						下一页
					</button>
				</div>
			)}
			{installedOnly && onMarket && (
				<button className="batch-link" onClick={onMarket}>
					找不到合适的工作流？前往 LoomLoom SkillBot 市场安装 →
				</button>
			)}
		</section>
	)
}
