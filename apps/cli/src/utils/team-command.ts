import { createTeamName } from "@coohu/core";
import { formatUserCommandBlock } from "@coohu/shared";
import type { Config } from "./types";

export const TEAM_COMMAND_USAGE =
	"用法：/team <任务描述>为指定任务启动一个智能体团队。";

type TeamPromptRewriteResult =
	| { kind: "none" }
	| { kind: "usage" }
	| { kind: "rewritten"; prompt: string };

export function rewriteTeamPrompt(input: string): TeamPromptRewriteResult {
	const match = /^\/team\b([\s\S]*)$/i.exec(input.trim());
	if (!match) {
		return { kind: "none" };
	}
	const taskBody = match[1].trim();
	if (!taskBody) {
		return { kind: "usage" };
	}
	return {
		kind: "rewritten",
		prompt: formatUserCommandBlock(
			`生成一组 Agent 以执行以下任务： ${taskBody}`,
			"team",
		),
	};
}

export async function enableTeamsForPrompt(config: Config): Promise<void> {
	if (config.enableAgentTeams) {
		return;
	}
	config.enableAgentTeams = true;
	config.teamName = config.teamName?.trim() || createTeamName();
}
