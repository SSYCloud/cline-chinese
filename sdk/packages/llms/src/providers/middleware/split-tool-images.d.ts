import type {
	LanguageModelV3Message,
	LanguageModelV3Middleware,
} from "@ai-sdk/provider";
/**
 * Walk a `LanguageModelV3Prompt` and rewrite every `role:"tool"` message
 * containing image/file parts inside its tool-result `output`s. See the
 * file-level comment for the rewrite shape.
 *
 * Returns the (possibly new) prompt array and a `mutated` flag for
 * test/observation use.
 */
export declare function rewritePromptToolImages(
	prompt: LanguageModelV3Message[],
): {
	prompt: LanguageModelV3Message[];
	mutated: boolean;
};
/**
 * `LanguageModelV3Middleware` that splits image-carrying tool-result
 * messages so chat-completions-style converters don't lose the bytes.
 *
 * Apply via `wrapLanguageModel({ model, middleware: splitToolImagesMiddleware })`
 * in any provider whose downstream converter doesn't natively handle
 * multimodal `role:"tool"` content (currently: `@ai-sdk/openai-compatible`,
 * `@ai-sdk/mistral`).
 *
 * Anthropic's converter natively renders content arrays on tool-result
 * messages and should NOT use this middleware — it would replace
 * structurally-faithful tool-results with the placeholder text + sibling
 * user message pattern unnecessarily.
 */
export declare const splitToolImagesMiddleware: LanguageModelV3Middleware;
