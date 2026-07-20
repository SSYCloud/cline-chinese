import type { TFunction } from "i18next"

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

export const getStepConfig = (t: TFunction) => ({
	0: {
		title: t("onboarding.howWillYouUse"),
		description: t("onboarding.selectOption"),
		buttons: [
			{ text: t("onboarding.continue"), action: "next", variant: "default" },
			{ text: t("onboarding.loginToCline"), action: "signin", variant: "secondary" },
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
		title: t("onboarding.selectFreeModel"),
		buttons: [
			{ text: t("onboarding.createMyAccount"), action: "signup", variant: "default" },
			{ text: t("onboarding.back"), action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.POWER]: {
		title: t("onboarding.selectYourModel"),
		buttons: [
			{ text: t("onboarding.createMyAccount"), action: "signup", variant: "default" },
			{ text: t("onboarding.back"), action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.BYOK]: {
		title: t("onboarding.configureYourProvider"),
		buttons: [
			{ text: t("onboarding.continue"), action: "done", variant: "default" },
			{ text: t("onboarding.back"), action: "back", variant: "secondary" },
		],
	},
	2: {
		title: t("onboarding.almostThere"),
		description: t("onboarding.completeInBrowser"),
		buttons: [{ text: t("onboarding.back"), action: "back", variant: "secondary" }],
	},
})

export const USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	{ title: "完全免费", description: "免费开始", type: NEW_USER_TYPE.FREE },
	{ title: "前沿模型", description: "Claude, GPT Codex, Gemini, 等.", type: NEW_USER_TYPE.POWER },
	{ title: "使用我自己的 API 密钥", description: "使用你选择的提供商", type: NEW_USER_TYPE.BYOK },
]

/** Free leads (and is the default); ClinePass is inserted second when its models are available. */
export function getUserTypeSelections(hasClinePassModels: boolean): UserTypeSelection[] {
	if (!hasClinePassModels) {
		return USER_TYPE_SELECTIONS
	}
	const [free, ...rest] = USER_TYPE_SELECTIONS
	return [free, USER_TYPE_SELECTIONS[0], ...rest]
}
