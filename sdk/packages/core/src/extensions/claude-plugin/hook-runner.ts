import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { z } from "zod";

const MAX_CAPTURED_OUTPUT_BYTES = 1_000_000;
const BLOCKING_EXIT_CODE = 2;

/**
 * The subset of Claude Code's hook JSON output that Cline acts on. Unknown
 * fields are ignored so newer Claude output shapes never break a hook run.
 */
const ClaudeHookJsonOutputSchema = z
	.object({
		continue: z.boolean().optional(),
		stopReason: z.string().optional(),
		decision: z.enum(["block", "approve"]).optional(),
		reason: z.string().optional(),
		hookSpecificOutput: z
			.object({
				permissionDecision: z.enum(["allow", "deny", "ask"]).optional(),
				permissionDecisionReason: z.string().optional(),
				updatedInput: z.record(z.string(), z.unknown()).optional(),
				additionalContext: z.string().optional(),
			})
			.optional(),
	})
	.passthrough();

export type ClaudeHookJsonOutput = z.infer<typeof ClaudeHookJsonOutputSchema>;

export type ClaudeHookRunResult =
	| { status: "success"; json?: ClaudeHookJsonOutput; text: string }
	| { status: "blocking"; message: string }
	| { status: "error"; message: string };

export interface RunClaudeHookOptions {
	command: string;
	cwd: string;
	env: Record<string, string>;
	input: Record<string, unknown>;
	timeoutSeconds: number;
	dataDirectory: string;
}

/**
 * Run one Claude hook command using Claude Code's protocol: the event payload is
 * written as JSON to stdin; exit 0 is success (stdout may be JSON control output
 * or plain text); exit 2 is a blocking error whose stderr is the reason; anything
 * else is a non-blocking error the run continues past.
 */
export async function runClaudeHookCommand(
	options: RunClaudeHookOptions,
): Promise<ClaudeHookRunResult> {
	await mkdir(options.dataDirectory, { recursive: true });
	const captured = await spawnAndCapture(options);
	if (captured.error) {
		return { status: "error", message: captured.error };
	}
	if (captured.exitCode === BLOCKING_EXIT_CODE) {
		return {
			status: "blocking",
			message: captured.stderr.trim() || "Hook blocked the operation.",
		};
	}
	if (captured.exitCode !== 0) {
		return {
			status: "error",
			message: `Hook exited with code ${captured.exitCode}: ${captured.stderr.trim()}`,
		};
	}
	return parseSuccessfulStdout(captured.stdout);
}

function parseSuccessfulStdout(stdout: string): ClaudeHookRunResult {
	const text = stdout.trim();
	if (!text.startsWith("{")) {
		return { status: "success", text };
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return { status: "success", text };
	}
	const parsed = ClaudeHookJsonOutputSchema.safeParse(raw);
	if (!parsed.success) {
		return { status: "success", text };
	}
	return { status: "success", json: parsed.data, text };
}

interface CapturedProcess {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	error?: string;
}

function spawnAndCapture(
	options: RunClaudeHookOptions,
): Promise<CapturedProcess> {
	return new Promise((resolve) => {
		const child = spawn(options.command, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			shell: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (result: CapturedProcess) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				resolve(result);
			}
		};
		const timer = setTimeout(() => {
			child.kill();
			finish({
				exitCode: null,
				stdout,
				stderr,
				error: `Hook timed out after ${options.timeoutSeconds}s.`,
			});
		}, options.timeoutSeconds * 1000);

		child.stdout.on("data", (chunk: Buffer) => {
			stdout = appendCapped(stdout, chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr = appendCapped(stderr, chunk);
		});
		child.on("error", (error) => {
			finish({ exitCode: null, stdout, stderr, error: error.message });
		});
		child.on("close", (exitCode) => {
			finish({ exitCode, stdout, stderr });
		});
		child.stdin.on("error", () => {});
		child.stdin.end(JSON.stringify(options.input));
	});
}

function appendCapped(current: string, chunk: Buffer): string {
	if (current.length >= MAX_CAPTURED_OUTPUT_BYTES) {
		return current;
	}
	return (current + chunk.toString("utf8")).slice(0, MAX_CAPTURED_OUTPUT_BYTES);
}
