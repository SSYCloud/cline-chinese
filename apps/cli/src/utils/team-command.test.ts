import { describe, expect, it } from "vitest";
import { rewriteTeamPrompt, TEAM_COMMAND_USAGE } from "./team-command";

describe("team command prompt rewrite", () => {
	it("does not rewrite non-team prompts", () => {
		expect(rewriteTeamPrompt("investigate rpc startup")).toEqual({
			kind: "none",
		});
	});

	it("rewrites /team prompts", () => {
		expect(rewriteTeamPrompt("/team investigate rpc startup")).toEqual({
			kind: "rewritten",
			prompt:
				'<user_command slash="team">为以下任务启动一个代理团队: investigate rpc startup</user_command>',
		});
	});

	it("preserves multiline team tasks", () => {
		expect(
			rewriteTeamPrompt("/team investigate rpc startup\ninclude tests"),
		).toEqual({
			kind: "rewritten",
			prompt:
				'<user_command slash="team">为以下任务启动一个代理团队: investigate rpc startup\ninclude tests</user_command>',
		});
	});

	it("returns usage for /team without a task", () => {
		expect(rewriteTeamPrompt("/team")).toEqual({ kind: "usage" });
		expect(TEAM_COMMAND_USAGE).toContain("/team <任务描述>");
	});
});
