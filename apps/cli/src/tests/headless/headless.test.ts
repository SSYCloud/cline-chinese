// ---------------------------------------------------------------------------
// CLI headless use cases  (cline -y / cline --json / piped stdin)
//
// These tests run cline as a child process (no TUI harness) and assert on
// stdout, stderr, and exit codes.
//
// Tests tagged @live require a configured provider and are skipped by default.
// Run them with:  CLINE_BIN=... npm test -- headless @live
//
// Cassette-backed runs pass --act. The cassettes were recorded in act mode,
// where a text-only reply ends the run. The default yolo mode ends only on a
// submit_and_exit call, so it sends a follow-up request the cassettes lack.
// ---------------------------------------------------------------------------

import { test } from "@microsoft/tui-test";
import {
	CLINE_BIN,
	EXIT_CODE_FAIL,
	EXIT_CODE_SUCCESS,
	TERMINAL_WIDE,
} from "../helpers/constants.js";
import { clineEnv } from "../helpers/env.js";
import { expectExitCode, expectVisible } from "../helpers/terminal.js";

// ---------------------------------------------------------------------------
// cline -y "tell me a joke"
// Golden path: prints only LLM output (no chrome), then exits 0.
// Unauthenticated: prints "Not authenticated" and exits 1.
// ---------------------------------------------------------------------------
test.describe("cline -y (headless auth failure mode) - unauthenticated", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-y", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});
});

// ---------------------------------------------------------------------------
// echo "max paulus" | cline "print only the second word I gave you"
// Piped stdin test - uses TUI harness with stdin pre-written
// ---------------------------------------------------------------------------
test.describe("piped stdin | cline - unauthenticated", () => {
	test.use({
		program: {
			file: "sh",
			args: [
				"-c",
				`echo "max paulus" | ${CLINE_BIN} "print only the second word I gave you"`,
			],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});
});

// ---------------------------------------------------------------------------
// cline -y --verbose "tell me a joke" 2>&1
// Golden path: prints model info, prompt, api request, reasoning, task_completion lines
// ---------------------------------------------------------------------------
test.describe("cline -y --verbose - unauthenticated", () => {
	test.use({
		program: {
			file: "sh",
			args: ["-c", `${CLINE_BIN} -y --verbose "tell me a joke" 2>&1`],
		},
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});
});

// ---------------------------------------------------------------------------
// cline -y --json "tell me a joke"
// Headless yolo with JSON output (one JSON object per line)
// ---------------------------------------------------------------------------
test.describe("cline -y --json - unauthenticated", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["-y", "--json", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("unauthenticated"),
	});

	test("outputs JSON error for unauthenticated", async ({ terminal }) => {
		await expectVisible(terminal, /"type":"error"/i);
		await expectVisible(terminal, /Unauthorized|Missing API key/i);
		await expectExitCode(terminal, EXIT_CODE_FAIL);
	});
});

test.describe("cline (headless prompt mode) - authenticated @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--act", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-yolo-basic.json",
		}),
	});
});

// ---------------------------------------------------------------------------
// echo "max paulus" | cline "..." - authenticated
// Piped stdin test with valid credentials
// ---------------------------------------------------------------------------
test.describe("piped stdin | cline - authenticated", () => {
	test.use({
		program: {
			file: "sh",
			args: [
				"-c",
				`echo "butterfly horse country" | ${CLINE_BIN} --act "print only the second word I gave you"`,
			],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-piped-stdin.json",
		}),
	});
});

// ---------------------------------------------------------------------------
// cline --verbose "tell me a joke" 2>&1 - authenticated
// Golden path: prints model info, prompt, api request, reasoning, task_completion
// ---------------------------------------------------------------------------
test.describe("cline --verbose - authenticated @live", () => {
	test.use({
		program: {
			file: "sh",
			args: ["-c", `${CLINE_BIN} --act --verbose "tell me a joke" 2>&1`],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-verbose.json",
		}),
	});
});

// ---------------------------------------------------------------------------
// cline --json "tell me a joke" - authenticated
// All output must conform to JSON (one JSON object per line)
// ---------------------------------------------------------------------------
test.describe("cline --json - authenticated @live", () => {
	test.use({
		program: { file: CLINE_BIN, args: ["--act", "--json", "tell me a joke"] },
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-json.json",
		}),
	});
});

// ---------------------------------------------------------------------------
// cline -t 2 -y "tell me a joke"
// Timeout: should print "Error: Timeout" and exit 1
// ---------------------------------------------------------------------------
test.describe("cline -t (timeout) - headless yolo", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["-t", "2", "-y", "tell me a long detailed joke"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-timeout.json",
		}),
	});
});

test.describe("cline --json -t (timeout) - JSON mode", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--json", "-t", "2", "tell me a long detailed joke"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-json-timeout.json",
		}),
	});
});

// ---------------------------------------------------------------------------
// cline -y -m <model-id> "what model are you"
// Model flag in headless mode - should use specified model but not persist
// ---------------------------------------------------------------------------
test.describe("cline -m (model flag in headless) @live", () => {
	test.use({
		program: {
			file: CLINE_BIN,
			args: ["--act", "-m", "anthropic/claude-sonnet-4", "what model are you"],
		},
		...TERMINAL_WIDE,
		env: clineEnv("default", {
			CLINE_VCR_CASSETTE: "./fixtures/headless-model-flag.json",
		}),
	});
});
