import { test } from "@microsoft/tui-test";
import { CLINE_BIN } from "./helpers/constants.js";
import { clineEnv } from "./helpers/env.js";
import { expectVisible } from "./helpers/terminal.js";

const HELP_TERMINAL = { columns: 120, rows: 50 };

// ===========================================================================
// cline --help  (root help)
// ===========================================================================
test.describe("cline --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// cline -h  (short help flag)
// ===========================================================================
test.describe("cline -h", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-h"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// cline history --help
// ===========================================================================
test.describe("cline history --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["history", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// cline h --help  (history alias)
// ===========================================================================
test.describe("cline h --help (history alias)", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["h", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// cline config --help
// ===========================================================================
test.describe("cline config --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["config", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// cline auth --help
// ===========================================================================
test.describe("cline auth --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["auth", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// cline version --help
// ===========================================================================
test.describe("cline version --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["version", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// cline update --help
// ===========================================================================
test.describe("cline update --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["update", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});
});

// ===========================================================================
// cline doctor --help
// ===========================================================================
test.describe("cline doctor --help", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["doctor", "--help"] },
		env: clineEnv("claude-sonnet-4.6"),
		...HELP_TERMINAL,
	});
});
