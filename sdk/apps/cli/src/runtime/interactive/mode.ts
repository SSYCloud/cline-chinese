import { createTool } from "@coohu/shared";
import type { Config } from "../../utils/types";
import { resolveSystemPrompt } from "../prompt";

type InteractiveUiMode = "plan" | "act";

export function createInteractiveModeSwitchTool(input: {
	config: Config;
	pendingModeChange: { current: InteractiveUiMode | null };
	tuiModeChanged: { current: ((mode: InteractiveUiMode) => void) | null };
}) {
	return createTool({
		name: "switch_to_act_mode",
		description:
			"从“规划模式”切换至“执行模式”。请在用户确认希望继续执行该计划后调用此指令。切勿主动调用，或在用户尚未同意之前调用。",
		inputSchema: {
			type: "object",
			properties: {},
		},
		timeoutMs: 5000,
		retryable: false,
		maxRetries: 0,
		execute: async () => {
			if (input.config.mode === "act") {
				return "Already in act mode.";
			}
			input.pendingModeChange.current = "act";
			input.tuiModeChanged.current?.("act");
			return "您已成功切换到执行模式，请继续执行计划。现在您可以编辑文件和运行命令。（switch_to_act_mode 工具仅在规划模式下可用。）";
		},
	});
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
