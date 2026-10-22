/**
 * Copy and navigation targets for the Cline Chinese onboarding/daily promo
 * popups. Content is deliberately kept as plain data so it can be swapped or
 * disabled (set to null) without touching the popup logic.
 */

export type PromoPopupKind = "newUser" | "daily"

export type PromoPrimaryAction = { type: "openUrl"; url: string } | { type: "batch" }

export interface PromoPopupContent {
	/** Small title shown in the popup header bar. */
	headerTitle: string
	/** Short kicker shown under the headline. */
	eyebrow: string
	title: string
	body: string
	primaryLabel: string
	primaryAction: PromoPrimaryAction
	secondaryLabel?: string
	secondaryUrl?: string
	/** Daily popup only: show the "more settings" opt-out row. */
	showOptOut?: boolean
}

/** Window event consumed by ChatView to switch the main UI into Batch mode. */
export const OPEN_BATCH_MODE_EVENT = "loomloom-open-batch"

export const NEW_USER_BENEFITS_URL = "https://console.shengsuanyun.com/user/recharge"
export const LOOMLOOM_INTRO_URL = "https://www.shengsuanyun.com/zh/loomloom"

/** First-phase copy. Set to null to stop showing the popup entirely. */
export const NEW_USER_PROMO: PromoPopupContent | null = {
	headerTitle: "欢迎使用 CLINE CHINESE",
	eyebrow: "AI 编程助手 · 新用户专享",
	title: "中文开发，从这里开始",
	body: "用中文描述需求，让 Cline Chinese 协助读代码、改代码和完成任务，全程中文思考中文输出过程，代码diff实时查看修改删减。新用户首充加赠 10%。",
	primaryLabel: "查看首充福利",
	primaryAction: { type: "openUrl", url: NEW_USER_BENEFITS_URL },
}

export const DAILY_PROMO: PromoPopupContent | null = {
	headerTitle: "CLINE CHINESE · 每日推荐",
	eyebrow: "Batch / Skill 创作者",
	title: "Batch 批量做，Skill 还能赚",
	body: "切换 Cline Chinese 专属 Batch 模式，用 SkillBot 一次处理多条任务。上传自己的 SkillBot 到市场，按平台规则赚取创作者收益与 Token 奖励。",
	primaryLabel: "试用 Batch 模式",
	primaryAction: { type: "batch" },
	secondaryLabel: "了解上传 Skill 与创作者收益 →",
	secondaryUrl: LOOMLOOM_INTRO_URL,
	showOptOut: true,
}

export function getPromoContent(kind: PromoPopupKind): PromoPopupContent | null {
	return kind === "newUser" ? NEW_USER_PROMO : DAILY_PROMO
}

/**
 * A popup is only eligible when the content required to render it is present.
 * This is what makes "no valid content -> no popup" hold even if the copy is
 * cleared out between releases.
 */
export function hasValidPromoContent(content: PromoPopupContent | null | undefined): content is PromoPopupContent {
	if (!content) {
		return false
	}
	const required = [content.headerTitle, content.eyebrow, content.title, content.body, content.primaryLabel]
	return required.every((value) => typeof value === "string" && value.trim().length > 0)
}
