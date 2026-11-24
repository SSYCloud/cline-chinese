import { describe, expect, it } from "vitest";
import { getTerminalTheme, themePalette } from "./palette";

describe("getTerminalTheme", () => {
	it("uses the foreground as a fallback when background is unavailable", () => {
		expect(getTerminalTheme(null, "#1a1a1a")).toBe("light");
		expect(getTerminalTheme(null, "#f0f0f0")).toBe("dark");
	});

	it("defaults to the existing dark theme when detection is unavailable", () => {
		expect(getTerminalTheme(null, null)).toBe("dark");
	});
});

describe("theme-aware palette helpers", () => {
	it("uses darker accents on light terminals", () => {
		expect(themePalette.light.act).toBe("#0f72cb");
		expect(themePalette.light.plan).toBe("#867100");
		expect(themePalette.light.success).toBe("#116329");
	});
});
