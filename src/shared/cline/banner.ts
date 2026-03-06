/**
 * Action types that can be triggered from banner buttons/links
 * Frontend maps these to actual handlers
 */
export enum BannerActionType {
	/** Open external URL */
	Link = "link",
	/** Open API settings tab */
	ShowApiSettings = "show-api-settings",
	/** Open feature settings tab */
	ShowFeatureSettings = "show-feature-settings",
	/** Open account/login view */
	ShowAccount = "show-account",
	/** Set the active model */
	SetModel = "set-model",
	/** Trigger CLI installation flow */
	InstallCli = "install-cli",
}

/**
 * Banner data structure for backend-to-frontend communication.
 * Backend constructs this JSON, frontend renders it via BannerCarousel.
 */
export interface BannerCardData {
	/** Unique identifier for the banner (used for dismissal tracking) */
	id: string

	/** Banner title text */
	title: string

	/** Banner description/body markdown text */
	description: string

	/**
	 * Icon ID from Lucide icon set (e.g., "lightbulb", "megaphone", "terminal")
	 * LINK: https://lucide.dev/icons/
	 * Optional - if omitted, no icon is shown
	 */
	icon?: string

	/**
	 * Optional footer action buttons
	 * Rendered below the description as prominent buttons
	 */
	actions?: BannerAction[]

	/**
	 * Platform filter - only show on specified platforms
	 * If undefined, show on all platforms
	 */
	platforms?: ("windows" | "mac" | "linux")[]

	/** Only show to Cline users */
	isClineUserOnly?: boolean
}

/**
 * Single action definition (button or link)
 */
export interface BannerAction {
	/** Button/link label text */
	title: string

	/**
	 * Action type - determines what happens on click
	 * Defaults to "link" if omitted
	 */
	action?: BannerActionType

	/**
	 * Action argument - interpretation depends on action type:
	 * - Link: URL to open
	 * - SetModel: model ID (e.g., "anthropic/claude-opus-4.5")
	 * - Others: generally unused
	 */
	arg?: string

	/**
	 * Optional model picker tab to open when using SetModel action
	 */
	tab?: "recommended" | "free"
}

/**
 * The list of predefined banner config rendered by the Welcome Section UI.
 * TODO: Backend would return a similar JSON structure in the future which we will replace this with.
 */

export const BANNER_DATA: BannerCardData[] = [
	// Sonnet 4.6 banner
	{
		// Bump this version string when copy/CTA changes and you want the banner to reappear.
		id: "anthropic/claude-sonnet-4.6",
		icon: "sparkles",
		title: "Try Claude Sonnet 4.6",
		description: "Anthropic 最新款模型，具有强大的推理和编码性能。",
		actions: [
			{
				title: "使用 Sonnet 4.6",
				action: BannerActionType.SetModel,
				arg: "anthropic/claude-sonnet-4.6",
				tab: "recommended",
			},
		],
	},

	// Minimax free promo banner
	{
		// Bump this version string when copy/CTA changes and you want the banner to reappear.
		id: "minimax/minimax-m2.5",
		icon: "zap",
		title: "Try MiniMax M2.5 Free",
		description: "Cline 具备最先进的编码能力和闪电般的推理速度，而且价格优惠。",
		actions: [
			{
				title: "使用",
				action: BannerActionType.SetModel,
				arg: "minimax/minimax-m2.5",
				tab: "free",
			},
		],
	},

	// ChatGPT integration banner
	{
		id: "openai/gpt-5.2-codex",
		icon: "megaphone",
		title: "使用 GPT 5.2 Codex",
		description: "将您的 ChatGPT 订阅迁移到 Cline！直接使用您现有的套餐，无需支付任何代币费用，也无需管理 API 密钥。",
		actions: [
			{
				title: "Connect",
				action: BannerActionType.ShowApiSettings,
				arg: "openai-codex", // Pre-select OpenAI Codex provider
			},
		],
	},

	// Jupyter Notebooks banner
	{
		id: "jupyter-notebooks-v1",
		icon: "book-open",
		title: "Jupyter 笔记",
		description:
			"全面支持 AI 辅助编辑 `.ipynb` 文件，并具备完整的单元格级上下文感知能力。[了解更多 →](https://docs.cline.bot/features/jupyter-notebooks)",
	},

	// Platform-specific banner (Windows)
	{
		id: "cli-info-windows-v1",
		icon: "terminal",
		title: "Cline CLI 信息",
		platforms: ["windows"] satisfies BannerCardData["platforms"],
		description: "适用于 macOS 和 Linux。即将支持其他平台。[了解更多](https://docs.cline.bot/cline-cli/overview)",
	},

	// Info banner with inline link
	{
		id: "info-banner-v1",
		icon: "lightbulb",
		title: "在右边栏使用 Cline",
		description:
			"为了获得最佳体验，请将 Cline 图标拖到右侧边栏。这样，您在与 Cline 聊天时，文件资源管理器和编辑器将保持可见，方便您浏览代码库并实时查看更改。[查看方法 →](https://docs.cline.bot/features/customization/opening-cline-in-sidebar)",
	},
]
