import { askQuestionInTerminal } from "../utils/approval";
import type { Config } from "../utils/types";

export function describeAbortSource(input: {
	abortRequested: boolean;
	timedOut: boolean;
}): string {
	if (input.timedOut) {
		return "因超时而中止";
	}
	if (input.abortRequested) {
		return "因用户请求而中止";
	}
	return "被另一个客户端中止";
}

export async function resolveMistakeLimitDecision(
	config: Config,
	context: {
		iteration: number;
		consecutiveMistakes: number;
		maxConsecutiveMistakes: number;
		reason: "api_error" | "invalid_tool_call" | "tool_execution_failed";
		details?: string;
	},
): Promise<
	| { action: "continue"; guidance?: string }
	| { action: "stop"; reason?: string }
> {
	const yoloEnabled = config.toolPolicies["*"]?.autoApprove !== false;
	if (yoloEnabled) {
		return {
			action: "stop",
			reason: `已达到最大连续错误次数 (${context.maxConsecutiveMistakes}) 在 yolo 模式`,
		};
	}
	const detail = context.details?.trim();
	const summary = detail
		? `${context.reason}: ${detail}`
		: `${context.reason} at iteration ${context.iteration}`;
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return {
			action: "stop",
			reason: `mistake_limit_reached: ${summary}`,
		};
	}
	const answer = await askQuestionInTerminal(
		`mistake_limit_reached (${context.consecutiveMistakes}/${context.maxConsecutiveMistakes})\nLatest: ${summary}\nHow should Cline continue?`,
		["Try a different approach", "Stop this run"],
	);
	const normalized = answer.trim().toLowerCase();
	if (
		normalized === "2" ||
		normalized === "stop this run" ||
		normalized === "stop" ||
		normalized === "n" ||
		normalized === "no"
	) {
		return {
			action: "stop",
			reason: "在收到 `mistake_limit_reached` 提示后停止",
		};
	}
	if (
		normalized === "1" ||
		normalized === "try a different approach" ||
		normalized.length === 0
	) {
		return {
			action: "continue",
			guidance:
				"mistake_limit_reached：请尝试更换策略重试；在调用工具前，请先验证工具参数，并避免重复执行已失败的步骤。",
		};
	}
	return {
		action: "continue",
		guidance: `mistake_limit_reached：${answer.trim()}`,
	};
}
