/**
 * Built-in provider IDs
 *
 * Single source of truth for all built-in provider identifiers.
 * Use BUILT_IN_PROVIDER_IDS for runtime operations (validation, iteration)
 * Use BuiltInProviderId type for compile-time type safety
 */
export declare enum BUILT_IN_PROVIDER {
    ANTHROPIC = "anthropic",
    CLAUDE_CODE = "claude-code",
    CLINE = "cline",
    OPENAI_COMPATIBLE = "openai-compatible",
    OPENAI_NATIVE = "openai-native",
    OPENAI_CODEX = "openai-codex",
    OPENAI_CODEX_CLI = "openai-codex-cli",
    OPENCODE = "opencode",
    BEDROCK = "bedrock",
    VERTEX = "vertex",
    GEMINI = "gemini",
    OLLAMA = "ollama",
    LMSTUDIO = "lmstudio",
    DEEPSEEK = "deepseek",
    XAI = "xai",
    TOGETHER = "together",
    FIREWORKS = "fireworks",
    GROQ = "groq",
    POOLSIDE = "poolside",
    CEREBRAS = "cerebras",
    SAMBANOVA = "sambanova",
    NEBIUS = "nebius",
    BASETEN = "baseten",
    REQUESTY = "requesty",
    LITELLM = "litellm",
    HUGGINGFACE = "huggingface",
    VERCEL_AI_GATEWAY = "vercel-ai-gateway",
    V0 = "v0",
    AIHUBMIX = "aihubmix",
    HICAP = "hicap",
    NOUS_RESEARCH = "nousResearch",
    HUAWEI_CLOUD_MAAS = "huawei-cloud-maas",
    WANDB = "wandb",
    XIAOMI = "xiaomi",
    KILO = "kilo",
    ZAI = "zai",
    ZAI_CODING_PLAN = "zai-coding-plan",
    QWEN = "qwen",
    QWEN_CODE = "qwen-code",
    DOUBAO = "doubao",
    MISTRAL = "mistral",
    MOONSHOT = "moonshot",
    ASKSAGE = "asksage",
    MINIMAX = "minimax",
    DIFY = "dify",
    OCA = "oca",
    SAPAICORE = "sapaicore",
    OPENROUTER = "openrouter",
    SHENGSUANYUN = "shengsuanyun"
}
/**
 * Provider ID aliases normalized to canonical built-in IDs.
 *
 * Keep this map as the single source of truth for alias handling.
 */
export declare const PROVIDER_ID_ALIASES: Record<string, BUILT_IN_PROVIDER>;
export declare const BUILT_IN_PROVIDER_IDS: [BUILT_IN_PROVIDER, ...BUILT_IN_PROVIDER[]];
/** Type derived from the array - use for type annotations */
export type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number];
/** Check if a string is a valid built-in provider ID */
export declare function isBuiltInProviderId(id: string): id is BuiltInProviderId;
/** Normalize provider aliases to canonical IDs */
export declare function normalizeProviderId(providerId: string): string;
