export enum NEW_USER_TYPE {
	CLINE_PASS = "cline-pass",
	FREE = "free",
	POWER = "power",
	BYOK = "byok",
}

type UserTypeSelection = {
	title: string
	description: string
	type: NEW_USER_TYPE
}

export const STEP_CONFIG = {
	0: {
		title: "你想怎么使用 Cline?",
		description: "选择一个下面的选项来开始.",
		buttons: [
			{ text: "继续", action: "next", variant: "default" },
			{ text: "登录到胜算云", action: "signin", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.CLINE_PASS]: {
		title: "Select a ClinePass model",
		buttons: [
			{ text: "Create my Account", action: "signup", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.FREE]: {
		title: "绝对免费",
		buttons: [
			{ text: "创建账户", action: "signup", variant: "default" },
			{ text: "返回", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.POWER]: {
		title: "选择你的模型",
		buttons: [
			{ text: "创建账户", action: "signup", variant: "default" },
			{ text: "返回", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.BYOK]: {
		title: "配置你的提供商 API 密钥",
		buttons: [
			{ text: "继续", action: "done", variant: "default" },
			{ text: "返回", action: "back", variant: "secondary" },
		],
	},
	2: {
		title: "几乎完成了！",
		description: "在浏览器中完成账户创建。然后回到这里完成最后的设置。",
		buttons: [{ text: "返回", action: "back", variant: "secondary" }],
	},
} as const

export const USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	{ title: "完全免费", description: "免费开始", type: NEW_USER_TYPE.FREE },
	{ title: "前沿模型", description: "Claude, GPT Codex, Gemini, 等.", type: NEW_USER_TYPE.POWER },
	{ title: "使用我自己的 API 密钥", description: "使用你选择的提供商", type: NEW_USER_TYPE.BYOK },
]

/**
 * Returns the onboarding user-type options. The free option leads the list and is
 * the default selection; ClinePass is inserted as a recommended-but-optional
 * choice (labeled "Recommended") right after it, only when the `ext-cline-pass`
 * feature flag is enabled. When the flag is off, the classic Free / Frontier /
 * BYOK options are shown unchanged.
 */
export function getUserTypeSelections(isClinePassEnabled: boolean): UserTypeSelection[] {
	if (!isClinePassEnabled) {
		return USER_TYPE_SELECTIONS
	}
	const [free, ...rest] = USER_TYPE_SELECTIONS
	return [free, USER_TYPE_SELECTIONS[0], ...rest]
}
