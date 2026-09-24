/** Development-only entry. Renders production components with explicitly simulated RPC/Agent data. */
import type { BatchSession, SkillBot } from "@shared/loomloom"
import { useState } from "react"
import { createRoot } from "react-dom/client"
import { LoomLoomServiceClient } from "@/services/grpc-client"
import { BatchConversation } from "./BatchConversation"
import { SkillBotMarket } from "./SkillBotMarket"
import "./batch.css"

const schema = {
	schema_version: "loom_market_public_input_schema_v1",
	input_summary: "根据原文和要求，逐条扩写内容。",
	fields: [
		{ key: "source", label: "扩写原文", value_type: "string", required: true, presentation: { widget: "textarea" } },
		{ key: "goal", label: "扩写目标", value_type: "string" },
		{ key: "modelChoice", label: "模型", value_type: "string" },
	],
}
const names = [
	"文本扩写助手",
	"视觉演示生成器",
	"全景门参数核算师",
	"全景门选型顾问",
	"国内电商经营数据诊断官",
	"商品图文生成器",
	"品牌内容改写",
]
const items: SkillBot[] = names.map((name, i) => ({
	id: `fixture-${i}`,
	name,
	description: "交互预览数据：选择后在当前对话中收集、检查并确认批量输入。",
	availability: "available",
	versionId: "fixture-v1",
	schema,
}))
const state: BatchSession = {
	version: 1,
	id: "preview",
	taskId: "preview-session",
	enabled: true,
	revision: 0,
	phase: "selecting",
	rows: [],
	results: [],
	artifacts: [],
	events: [],
}
let notify = () => {}
function changed(text?: string) {
	if (text) state.events.push({ id: crypto.randomUUID(), at: Date.now(), text })
	notify()
}
function invalidate() {
	state.revision++
	if (state.quote) state.quote.valid = false
	state.phase = "collecting"
}
LoomLoomServiceClient.skillBotCatalog = async (request) => {
	const input = JSON.parse(request.value || "{}"),
		page = input.page || 0
	return {
		value: JSON.stringify({
			items: input.installed ? items.slice(page * 5, page * 5 + 5) : items,
			pages: 2,
			installedIds: items.map((i) => i.id),
			nextPageToken: "",
		}),
	}
}
LoomLoomServiceClient.batchModels = async () => ({ value: "[]" })
LoomLoomServiceClient.selectBatchAttachment = async (request) => {
	const input = JSON.parse(request.value),
		row = state.rows.find((r) => r.id === input.rowId)!
	row.attachments.push({ id: crypto.randomUUID(), name: "商品说明.md", path: "示例/商品说明.md" })
	invalidate()
	changed("已添加示例参考文件。")
	return { value: JSON.stringify(state) }
}
LoomLoomServiceClient.batchCommand = async (request) => {
	const { command: c } = JSON.parse(request.value)
	if (c.action === "select") {
		state.listing = items.find((i) => i.id === c.listingId)
		state.phase = "quantity"
		changed("已加载 SkillBot，请确定本次生成数量。")
	}
	if (c.action === "quantity") {
		state.rows = Array.from({ length: c.count }, (_, i) => ({ id: `row-${i}`, values: {}, attachments: [] }))
		invalidate()
		changed(`本次准备 ${c.count} 条输入。`)
	}
	if (c.action === "patch") {
		for (const row of c.rows) Object.assign(state.rows.find((r) => r.id === row.id)!.values, row.values)
		invalidate()
		changed("输入已更新。")
	}
	if (c.action === "removeAttachment") {
		const row = state.rows.find((r) => r.id === c.rowId)!
		row.attachments = row.attachments.filter((a) => a.id !== c.attachmentId)
		invalidate()
	}
	if (c.action === "review") {
		if (state.rows.some((r) => !r.values.source)) throw new Error("请先补充每条的扩写原文。 ")
		state.phase = "reviewing"
		changed("请检查输入表，确认后获取预算。")
	}
	if (c.action === "revise") {
		invalidate()
		state.phase = "reviewing"
		changed("之前的预算已失效。")
	}
	if (c.action === "quote") {
		state.phase = "quoted"
		state.quote = {
			id: crypto.randomUUID(),
			revision: state.revision,
			hash: "fixture",
			versionId: "fixture-v1",
			inputRows: state.rows.map((r) => r.values),
			payable: { amount: "0.30", currency: "CNY（模拟）" },
			taskCount: state.rows.length,
			at: Date.now(),
			valid: true,
		}
		changed("模拟预算已返回。")
	}
	if (c.action === "execute") {
		state.phase = "running"
		state.attempt = { requestId: "preview-request", runId: "preview-run", quote: state.quote! }
		state.progress = { status: "running", total: state.rows.length, completed: 0, failed: 0 }
		changed("模拟执行中，不会产生费用。")
		setTimeout(() => {
			state.phase = "completed"
			state.progress = { status: "completed", total: state.rows.length, completed: state.rows.length, failed: 0 }
			state.results = state.rows.map((row, i) => ({
				rowIndex: i,
				status: "completed",
				artifacts: [{ inlineText: `演示结果 ${i + 1}：${row.values.source}`, artifactId: `artifact-${i}` }],
			}))
			changed("模拟执行完成，可继续在同一对话中使用结果。")
		}, 1200)
	}
	changed()
	return { value: JSON.stringify(state) }
}
function Preview() {
	const [snapshot, setSnapshot] = useState(structuredClone(state)),
		[market, setMarket] = useState(false),
		[prompt, setPrompt] = useState(""),
		[messages, setMessages] = useState<string[]>([])
	notify = () => setSnapshot(structuredClone(state))
	async function chat(text: string) {
		setMessages((old) => [...old, text, "Cline Chinese：已将材料整理到下方输入表（此预览模拟 Agent 整理）。"])
		state.rows.forEach((row, i) => {
			row.values.source = `素材 ${i + 1}：${text}`
			row.values.goal = "保留事实，表达清晰"
		})
		invalidate()
		changed("已通过模拟聊天整理输入。")
	}
	return (
		<>
			<style>{`
:root{--vscode-foreground:#ccc;--vscode-descriptionForeground:#999;--vscode-panel-border:#343434;--vscode-input-foreground:#ccc;--vscode-input-background:#3c3c3c;--vscode-editor-background:#181818;--vscode-button-background:#0e639c;--vscode-button-foreground:#fff;--vscode-button-secondaryBackground:#2d2d2d;--vscode-button-secondaryForeground:#ccc;--vscode-focusBorder:#007fd4;--vscode-errorForeground:#f48771;--vscode-textLink-foreground:#3794ff;--vscode-textBlockQuote-background:#20282b;--vscode-editor-inactiveSelectionBackground:#292d2e}*{box-sizing:border-box}body{margin:0;background:#101010;color:#ccc;font:13px 'Segoe UI',sans-serif}.preview-shell{max-width:720px;height:100vh;margin:auto;background:#181818;display:flex;flex-direction:column;border:1px solid #343434}.preview-bar{padding:12px;border-bottom:1px solid #343434;display:flex;justify-content:space-between}.preview-hint{font-size:11px;color:#aaa;padding:6px 12px;border-bottom:1px solid #343434}.preview-scroll{flex:1;overflow:auto;min-height:0}.preview-message{padding:12px;border-bottom:1px solid #343434;white-space:pre-wrap}.preview-composer{padding:10px;border-top:1px solid #343434}.preview-composer textarea{background:#3c3c3c;color:#ccc;border:1px solid #444;padding:10px;width:100%;font:inherit;resize:vertical}.preview-modes{display:flex;justify-content:space-between;align-items:center;margin-top:6px}.preview-modes span{font-size:11px;color:#aaa}.preview-modes strong{background:#0e639c;padding:4px 14px}.preview-market{padding:12px}
`}</style>
			<main className="preview-shell">
				<header className="preview-bar">
					<span>CLINE CHINESE</span>
					<span>＋　⚙</span>
				</header>
				<div className="preview-hint">
					开发预览 · 使用正式 Batch 组件 · 所有模型、报价、文件和运行均为模拟，不连接云端
				</div>
				<section className="preview-scroll">
					{market ? (
						<div className="preview-market">
							<button onClick={() => setMarket(false)}>← 返回当前 Batch 对话</button>
							<SkillBotMarket
								onSelect={async (item) => {
									await LoomLoomServiceClient.batchCommand({
										value: JSON.stringify({ command: { action: "select", listingId: item.id } }),
									})
									setMarket(false)
								}}
							/>
						</div>
					) : (
						<>
							<div className="preview-message">使用 LoomLoom 工作流完成批量任务</div>
							{messages.map((m, i) => (
								<div className="preview-message" key={`${i}-${m}`}>
									{m}
								</div>
							))}
							<BatchConversation onChat={chat} onMarket={() => setMarket(true)} session={snapshot} />
						</>
					)}
				</section>
				<footer className="preview-composer">
					<textarea
						aria-label="Cline 聊天输入"
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="描述任务、提供素材，或继续向 Cline 提问…"
						rows={3}
						value={prompt}
					/>
					<div className="preview-modes">
						<span>＠　＋　当前 Cline 会话</span>
						<div>
							Plan　 Act　 <strong>Batch</strong>　
							<button
								onClick={() => {
									if (prompt.trim()) {
										void chat(prompt)
										setPrompt("")
									}
								}}>
								发送 ↑
							</button>
						</div>
					</div>
				</footer>
			</main>
		</>
	)
}
createRoot(document.getElementById("root")!).render(<Preview />)
