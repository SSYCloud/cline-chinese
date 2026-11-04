import type { ModelInfo } from "./api"

export const TYPESAFE_MODELS: Record<string, ModelInfo> = {
	"typesafe/jev-latest": {
		name: "Jev Latest",
		contextWindow: 32_000,
		inputPrice: 0.31,
		outputPrice: 0,
		supportsPromptCache: false,
		description:
			"Jev 是 TypeSafe 开发的结构化决策模型，也是其 System One 系列的首款模型。System One 模型能够为软件快速做出结构化决策，返回的是类型化的选项，而非自由格式的文本。它适用于应用程序内部的路由、分类和其他决策点，在这些场景中，快速、可预测的答案比生成的文本更为重要。",
	},
	"codiv/openjev-latest": {
		name: "OpenJev Latest",
		contextWindow: 64_000,
		inputPrice: 0,
		outputPrice: 0,
		supportsPromptCache: false,
		description:
			"OpenJev 将离散扩散语言模型DiffusionGemma 26B-A4B转换为 System One 模型。它将答案模板写入模型的画布，仅将答案槽位作为噪声，并通过一次去噪步骤读取每个槽位的概率分布。由于没有答案生成和解析过程，因此答案永远不会超出您的模式。",
	},
}

export const DEFAULT_TYPESAFE_MODEL = "typesafe/jev-latest"
