import { ChevronDownIcon, XIcon } from "lucide-react"
import { useState } from "react"
import ClineLogoPanda from "@/assets/ClineLogoPanda"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import type { PromoPopupContent, PromoPopupKind } from "./promoContent"

interface ChinesePromoModalProps {
	kind: PromoPopupKind
	content: PromoPopupContent
	/** Daily only: whether the "以后不再自动显示每日弹窗" checkbox is checked. */
	optOut: boolean
	onOptOutChange: (checked: boolean) => void
	onClose: () => void
	onPrimary: () => void
	onSecondary?: () => void
}

/**
 * Shared visual shell for the new-user and daily promo popups. The two variants
 * differ only in header label, copy, actions and the daily-only opt-out area.
 */
const ChinesePromoModal = ({
	kind,
	content,
	optOut,
	onOptOutChange,
	onClose,
	onPrimary,
	onSecondary,
}: ChinesePromoModalProps) => {
	const [settingsExpanded, setSettingsExpanded] = useState(false)

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					onClose()
				}
			}}
			open>
			<DialogContent
				aria-describedby="chinese-promo-body"
				aria-labelledby="chinese-promo-title"
				className="top-1/2 translate-y-[-50%] w-[calc(100vw-2rem)] max-w-[400px] gap-0 overflow-hidden rounded-lg border border-[var(--vscode-widget-border)] bg-[var(--vscode-editor-background)] p-0 shadow-lg"
				hideClose>
				{/* Header */}
				<div className="flex items-center justify-between gap-2 border-b border-[var(--vscode-widget-border)] bg-[var(--vscode-sideBar-background)] px-4 py-2.5">
					<div className="flex min-w-0 items-center gap-2">
						<ClineLogoPanda className="size-4 shrink-0" />
						<span className="truncate text-[11px] font-medium tracking-wide text-[var(--vscode-descriptionForeground)] uppercase">
							{content.headerTitle}
						</span>
					</div>
					<button
						aria-label="关闭"
						className="shrink-0 rounded-xs p-1 text-[var(--vscode-descriptionForeground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
						onClick={onClose}
						type="button">
						<XIcon className="size-4" />
					</button>
				</div>

				{/* Body */}
				<div className="px-5 pb-4 pt-5">
					<h2
						className="mb-2 text-lg font-semibold leading-snug text-[var(--vscode-foreground)]"
						id="chinese-promo-title">
						{content.title}
					</h2>
					<div className="mb-3 flex items-center gap-1.5 text-xs text-[var(--vscode-textLink-foreground)]">
						<span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
						<span>{content.eyebrow}</span>
					</div>
					<p
						className="mb-4 text-sm leading-relaxed text-[var(--vscode-descriptionForeground)]"
						id="chinese-promo-body">
						{content.body}
					</p>

					<Button className="w-full" onClick={onPrimary}>
						{content.primaryLabel}
					</Button>

					{content.secondaryLabel && onSecondary && (
						<button
							className="mt-3 w-full text-center text-sm text-[var(--vscode-textLink-foreground)] hover:underline"
							onClick={onSecondary}
							type="button">
							{content.secondaryLabel}
						</button>
					)}

					{kind === "daily" && content.showOptOut && (
						<div className="mt-4 border-t border-[var(--vscode-widget-border)]">
							<button
								aria-expanded={settingsExpanded}
								className="flex w-full items-center justify-between py-3 text-xs text-[var(--vscode-descriptionForeground)] hover:text-[var(--vscode-foreground)]"
								onClick={() => setSettingsExpanded((expanded) => !expanded)}
								type="button">
								<span>更多设置</span>
								<ChevronDownIcon
									className={cn("size-3.5 transition-transform", settingsExpanded && "rotate-180")}
								/>
							</button>
							{settingsExpanded && (
								<label className="flex cursor-pointer items-start gap-2 pb-3 text-xs text-[var(--vscode-descriptionForeground)]">
									<input
										checked={optOut}
										className="mt-0.5 size-3.5 shrink-0 cursor-pointer accent-[var(--vscode-button-background)]"
										onChange={(event) => onOptOutChange(event.target.checked)}
										type="checkbox"
									/>
									<span>以后不再自动显示每日弹窗</span>
								</label>
							)}
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}

export default ChinesePromoModal
