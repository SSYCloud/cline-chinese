import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import { expectVisible } from "./helpers/terminal.js";

// Wide enough that long option descriptions (e.g. --thinking) render on a
// single line. At narrower widths commander wraps them, splitting phrases
// like "the level last chosen with /model" across lines so the contiguous
// getByText assertions below fail.
const HELP_TERMINAL = { columns: 200, rows: 50 };

// ===========================================================================
// Root-level flag descriptions
// ===========================================================================
test.describe("root flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});

	test("all root flags have correct descriptions", async ({ terminal }) => {
		await expectVisible(terminal, [
			"Run in plan mode",
			"timeout in seconds",
			"Model to use",
			"verbose output",
			"Working directory",
			"Configuration directory",
			"Set reasoning effort:",
			"Bare --thinking uses medium",
			"the level last chosen with /model, or the provider default",
			"consecutive mistakes",
			"Output messages as JSON",
			"Check for updates and install if available",
			"Run the kanban app",
		]);
	});
});

// ===========================================================================
// History subcommand flag descriptions
// ===========================================================================
test.describe("history flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// Auth subcommand flag descriptions
// ===========================================================================
test.describe("auth flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["auth", "--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// Config subcommand flag descriptions
// ===========================================================================
test.describe("config flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config", "--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// Update subcommand flag descriptions
// ===========================================================================
test.describe("update flag descriptions", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["update", "--help"] },
		env: clineEnv("default"),
		...HELP_TERMINAL,
	});
});
