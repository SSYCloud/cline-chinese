export interface MistakeLimitContext {
	iteration: number;
	consecutiveMistakes: number;
	maxConsecutiveMistakes: number;
	reason: "api_error" | "invalid_tool_call" | "tool_execution_failed";
	details?: string;
}

export function createMistakeLimitDecisionResolver(input: {
	autoApproveAllRef: { current: boolean };
	askQuestionRef: {
		current: ((question: string, options: string[]) => Promise<string>) | null;
	};
}) {
	return async (context: MistakeLimitContext) => {
		if (input.autoApproveAllRef.current) {
			return {
				action: "stop" as const,
				reason: `max consecutive mistakes reached (${context.maxConsecutiveMistakes}) in yolo mode`,
			};
		}
		const detail = context.details?.trim();
		const summary = detail
			? `${context.reason}: ${detail}`
			: `${context.reason} at iteration ${context.iteration}`;
		const questionText = `mistake_limit_reached (${context.consecutiveMistakes}/${context.maxConsecutiveMistakes})\nLatest: ${summary}\nHow should Cline continue?`;
		const questionOptions = ["Try a different approach", "Stop this run"];
		const answer = input.askQuestionRef.current
			? await input.askQuestionRef.current(questionText, questionOptions)
			: (questionOptions[0] ?? "");
		const normalized = answer.trim().toLowerCase();
		if (
			normalized === "2" ||
			normalized === "stop this run" ||
			normalized === "stop" ||
			normalized === "n" ||
			normalized === "no"
		) {
			return {
				action: "stop" as const,
				reason: "在收到 `mistake_limit_reached` 提示后停止",
			};
		}
		if (
			normalized === "1" ||
			normalized === "try a different approach" ||
			normalized.length === 0
		) {
			return {
				action: "continue" as const,
				guidance:
					"mistake_limit_reached：请尝试更换策略重试；在调用工具前，请先验证工具参数，并避免重复执行已失败的步骤。",
			};
		}
		return {
			action: "continue" as const,
			guidance: `mistake_limit_reached: ${answer.trim()}`,
		};
	};
}
