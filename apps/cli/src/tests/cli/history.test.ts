// ---------------------------------------------------------------------------
// cline history - CLI tests
//
// Covers:
//   - `cline history --limit X`  - result limit
//   - `cline history --config`   - custom config directory
//   - `cline history --help`     - help page
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test";
import { CLINE_BIN, TERMINAL_WIDE } from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import { expectVisible } from "../helpers/terminal.js";

test.describe("cline history --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--help"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});
});

test.describe("cline history --limit", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--limit", "1"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});
});

test.describe("cline history --config (default)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history"] },
		...TERMINAL_WIDE,
		env: clineEnv("default"),
	});
});

test.describe("cline history --config (claude-sonnet-4.6)", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["history", "--config", "configs/claude-sonnet-4.6"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("claude-sonnet-4.6"),
	});
});
