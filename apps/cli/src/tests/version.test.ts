import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import { expectVisible } from "./helpers/terminal.js";

// ---------------------------------------------------------------------------
// cline --version  (root flag)
// ---------------------------------------------------------------------------
test.describe("cline --version", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--version"] },
		env: clineEnv("claude-sonnet-4.6"),
	});
});

// ---------------------------------------------------------------------------
// cline -V  (short flag)
// ---------------------------------------------------------------------------
test.describe("cline -V", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-V"] },
		env: clineEnv("claude-sonnet-4.6"),
	});
});

// ---------------------------------------------------------------------------
// cline version  (subcommand)
// ---------------------------------------------------------------------------
test.describe("cline version subcommand", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["version"] },
		env: clineEnv("claude-sonnet-4.6"),
	});
});
