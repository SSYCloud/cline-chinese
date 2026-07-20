import { createTool } from "@coohu/shared";
import type { Config } from "../../utils/types";
import { resolveSystemPrompt } from "../prompt";

export type InteractiveUiMode = "plan" | "act";

/**
 * Pending mode change plus who requested it. The switch_to_act_mode tool and
 * the TUI mode toggle share this slot, but only a tool-initiated switch means
 * "the user approved the plan" -- a UI toggle that lands as a turn finishes
 * must not trigger plan execution.
 */
export type PendingModeChange = {
	current: InteractiveUiMode | null;
	source: "tool" | "ui" | null;
};

export type AppliedModeChange = {
	mode: InteractiveUiMode;
	source: "tool" | "ui";
};

/**
 * Canned prompt that drives the auto-continue turn after the model calls
 * switch_to_act_mode. It is a synthetic user message, so transcript hydration
 * filters it out of the chat display.
 */
export const ACT_MODE_CONTINUATION_PROMPT =
	"The user approved switching to act mode. Continue with the approved plan now.";

export function createInteractiveModeSwitchTool(input: {
	config: Config;
	pendingModeChange: PendingModeChange;
	tuiModeChanged: { current: ((mode: InteractiveUiMode) => void) | null };
}) {
	return createTool({
		name: "switch_to_act_mode",
		description:
			"从“计划模式”切换到“执行模式”。切换到执行模式即意味着立即开始执行计划，因此，务必仅在用户明确批准该计划后才调用此操作——且该批准必须是在你展示计划之后发送的消息中给出的（例如“看起来不错”、“继续”、“切换到执行模式”）。" +
"切勿在展示计划的同一轮对话中调用此操作，切勿主动发起调用，也切勿将最初的任务请求视为批准。",
		inputSchema: {
			type: "object",
			properties: {},
		},
		timeoutMs: 5000,
		retryable: false,
		maxRetries: 0,
		// The act-mode tools only exist after the session is rebuilt with the
		// new mode config, which can't happen mid-run. End the run right after
		// the tool result so the model never keeps working with plan-mode tools
		// it was just told it no longer has; run-interactive applies the pending
		// change and auto-continues on the rebuilt session.
		lifecycle: {
			completesRun: true,
		},
		execute: async () => {
			if (input.config.mode === "act") {
				// Throw instead of returning: a successful result would end the
				// run via completesRun even though nothing changed.
				throw new Error("Already in act mode.");
			}
			input.pendingModeChange.current = "act";
			input.pendingModeChange.source = "tool";
			input.tuiModeChanged.current?.("act");
			return "您已成功切换到执行模式，请继续执行计划。现在您可以编辑文件和运行命令。（switch_to_act_mode 工具仅在规划模式下可用。）";
		},
	});
}

/**
 * Runs one interactive turn, and when the model ended it by calling
 * switch_to_act_mode, continues the approved plan on the rebuilt act-mode
 * session instead of waiting for the user to prompt again.
 *
 * The continuation only fires for a tool-initiated switch on a turn that
 * finished "completed": a UI toggle mid-run aborts the turn, and even if the
 * toggle races a natural completion its source is "ui", so the user's Tab
 * press can never start executing a plan they did not approve.
 */
export async function sendTurnWithActModeContinuation<
	T extends { finishReason: string; iterations: number },
>(input: {
	sendInitialTurn: () => Promise<T | undefined>;
	sendContinuationTurn: (prompt: string) => Promise<T | undefined>;
	applyPendingModeChange: () => Promise<AppliedModeChange | undefined>;
}): Promise<T | undefined> {
	const result = await input.sendInitialTurn();
	const switched = await input.applyPendingModeChange();
	if (
		switched?.mode !== "act" ||
		switched.source !== "tool" ||
		result?.finishReason !== "completed"
	) {
		return result;
	}
	const continuation = await input.sendContinuationTurn(
		ACT_MODE_CONTINUATION_PROMPT,
	);
	// Honor a mode toggle made while the continuation was running.
	await input.applyPendingModeChange();
	if (!continuation) {
		return result;
	}
	return {
		...continuation,
		iterations: result.iterations + continuation.iterations,
	};
}

export type ModeSwitchNotice = {
	from: InteractiveUiMode;
	to: InteractiveUiMode;
};

/**
 * Tracks a user-initiated mode switch so the next user message can carry a
 * <mode_notice> marking it. Only UI toggles are recorded: the model-initiated
 * switch_to_act_mode path already announces itself via the continuation
 * prompt. A round trip (plan -> act -> plan before sending anything) cancels
 * out, since the mode the model last saw never effectively changed.
 */
export function createModeSwitchNoticeTracker() {
	let pending: ModeSwitchNotice | null = null;
	return {
		record(from: InteractiveUiMode, to: InteractiveUiMode): void {
			if (from === to) {
				return;
			}
			if (pending) {
				pending = pending.from === to ? null : { from: pending.from, to };
				return;
			}
			pending = { from, to };
		},
		consume(): ModeSwitchNotice | null {
			const notice = pending;
			pending = null;
			return notice;
		},
	};
}

export async function applyInteractiveModeConfig(input: {
	config: Config;
	mode: InteractiveUiMode;
	switchToActModeTool: NonNullable<Config["extraTools"]>[number];
}): Promise<void> {
	input.config.mode = input.mode;
	input.config.extraTools =
		input.mode === "plan" ? [input.switchToActModeTool] : [];
	input.config.systemPrompt = await resolveSystemPrompt({
		cwd: input.config.cwd,
		providerId: input.config.providerId,
		mode: input.mode,
	});
}
