import { describe, expect, test } from "vitest";
import {
	markdownCodeHighlighter,
	SUPPORTED_MARKDOWN_LANGUAGES,
} from "../components/markdown";

function highlight(code: string, language: "typescript") {
	return new Promise<
		NonNullable<ReturnType<typeof markdownCodeHighlighter.highlight>>
	>((resolve) => {
		const immediate = markdownCodeHighlighter.highlight(
			{ code, language, themes: ["github-light", "github-dark"] },
			resolve,
		);
		if (immediate) resolve(immediate);
	});
}

describe("markdownCodeHighlighter", () => {
	test("loads a supported grammar and returns themed tokens", async () => {
		const result = await highlight("const answer: number = 42;", "typescript");

		expect(
			result.tokens
				.flat()
				.map((token) => token.content)
				.join(""),
		).toBe("const answer: number = 42;");
		expect(result.tokens.flat().some((token) => token.htmlStyle?.color)).toBe(
			true,
		);
	});
});
