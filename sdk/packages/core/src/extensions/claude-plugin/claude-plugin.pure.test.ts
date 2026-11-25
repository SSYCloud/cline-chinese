// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these tests feed Claude Code's literal ${CLAUDE_PLUGIN_*} placeholders into the loader.
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	parseClaudeCommandMarkdown,
	renderClaudeCommandPrompt,
} from "./commands";
import { createClaudeHookBridge } from "./hook-bridge";
import {
	matchesClaudeHookMatcher,
	parseClaudeHooksDocument,
} from "./hook-config";
import { parseClaudeSkillMarkdown } from "./skills";
import {
	fromClaudeToolInput,
	matchableToolNames,
	toClaudeToolInput,
} from "./tool-names";

describe("parseClaudeHooksDocument", () => {
	it("expands matcher groups into one binding per handler with defaults applied", () => {
		const parsed = parseClaudeHooksDocument({
			hooks: {
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [
							{ type: "command", command: "./guard.sh" },
							{ type: "command", command: "./audit.sh", timeout: 5 },
						],
					},
				],
				SessionStart: [{ hooks: [{ type: "command", command: "./init.sh" }] }],
			},
		});

		expect(parsed.problems).toEqual([]);
		expect(parsed.bindings).toEqual([
			{
				event: "PreToolUse",
				matcher: "Bash",
				command: "./guard.sh",
				timeoutSeconds: 60,
			},
			{
				event: "PreToolUse",
				matcher: "Bash",
				command: "./audit.sh",
				timeoutSeconds: 5,
			},
			{ event: "SessionStart", command: "./init.sh", timeoutSeconds: 60 },
		]);
	});

	it("drops the wildcard matcher so it is not stored as a filter", () => {
		const parsed = parseClaudeHooksDocument({
			hooks: {
				PostToolUse: [
					{ matcher: "*", hooks: [{ type: "command", command: "x" }] },
				],
			},
		});
		expect(parsed.bindings).toHaveLength(1);
		expect(parsed.bindings[0]).not.toHaveProperty("matcher");
	});

	it("reports each unusable entry while keeping the valid handlers", () => {
		const parsed = parseClaudeHooksDocument({
			hooks: {
				PreToolUse: [
					{
						matcher: "(",
						hooks: [{ type: "command", command: "bad-regex" }],
					},
					{
						matcher: "Edit",
						hooks: [
							{ type: "prompt", prompt: "llm" },
							{ type: "command", command: "" },
							{ type: "command", command: "good", timeout: -1 },
							{ type: "command", command: "kept" },
						],
					},
				],
				Notification: [{ hooks: [{ type: "command", command: "ignored" }] }],
				Mystery: [],
			},
		});

		expect(parsed.bindings).toEqual([
			{
				event: "PreToolUse",
				matcher: "Edit",
				command: "kept",
				timeoutSeconds: 60,
			},
		]);
		expect(parsed.problems).toEqual([
			"PreToolUse matcher '(' is not a valid regular expression.",
			"PreToolUse hook handler must have type 'command'; other handler types are ignored.",
			"PreToolUse hook handler requires a non-empty 'command'.",
			"PreToolUse hook 'timeout' must be a positive number of seconds.",
			"Hook event 'Notification' is not supported by Cline and is ignored.",
			"Unknown hook event 'Mystery' is ignored.",
		]);
	});

	it("rejects a document without a hooks object", () => {
		expect(parseClaudeHooksDocument([])).toEqual({
			bindings: [],
			modules: [],
			problems: ["hooks document must contain a 'hooks' object."],
		});
	});

	it("ignores a matcher on events that do not support one", () => {
		const parsed = parseClaudeHooksDocument({
			hooks: {
				Stop: [{ matcher: "Bash", hooks: [{ type: "command", command: "s" }] }],
			},
		});
		expect(parsed.bindings).toEqual([
			{ event: "Stop", command: "s", timeoutSeconds: 60 },
		]);
		expect(parsed.problems).toEqual([
			"Stop does not support matchers; the matcher is ignored.",
		]);
	});
});

describe("matchesClaudeHookMatcher", () => {
	it("anchors the matcher so a name only matches the whole tool name", () => {
		expect(matchesClaudeHookMatcher("Edit", ["Edit"])).toBe(true);
		expect(matchesClaudeHookMatcher("Edit", ["MultiEdit"])).toBe(false);
		expect(matchesClaudeHookMatcher("Edit", ["Editor"])).toBe(false);
	});

	it("accepts a regular expression alternation over tool names", () => {
		expect(matchesClaudeHookMatcher("Edit|Write", ["Write"])).toBe(true);
		expect(matchesClaudeHookMatcher("Edit|Write", ["Read"])).toBe(false);
	});

	it("matches every tool for an absent, empty, or wildcard matcher", () => {
		expect(matchesClaudeHookMatcher(undefined, ["anything"])).toBe(true);
		expect(matchesClaudeHookMatcher("", ["anything"])).toBe(true);
		expect(matchesClaudeHookMatcher("*", ["anything"])).toBe(true);
	});

	it("matches when any of the candidate names matches", () => {
		expect(
			matchesClaudeHookMatcher("Bash", matchableToolNames("run_commands")),
		).toBe(true);
		expect(
			matchesClaudeHookMatcher(
				"run_commands",
				matchableToolNames("run_commands"),
			),
		).toBe(true);
	});
});

describe("tool name translation", () => {
	it("exposes the Claude alias ahead of the native Cline name", () => {
		expect(matchableToolNames("editor")).toEqual(["Edit", "editor"]);
		expect(matchableToolNames("unknown_tool")).toEqual(["unknown_tool"]);
	});

	it("rewrites run_commands input to Claude's Bash command string and back", () => {
		const claudeInput = toClaudeToolInput("run_commands", {
			commands: ["ls -la", "pwd"],
		});
		expect(claudeInput).toEqual({ command: "ls -la\npwd" });
		expect(
			fromClaudeToolInput("run_commands", { command: "git status" }),
		).toEqual({
			commands: ["git status"],
		});
	});

	it("exposes Cline's path as Claude's file_path for file tools without losing path", () => {
		expect(
			toClaudeToolInput("editor", { path: "src/a.ts", new_text: "x" }),
		).toEqual({
			path: "src/a.ts",
			new_text: "x",
			file_path: "src/a.ts",
		});
		expect(toClaudeToolInput("read_files", { path: "README.md" })).toEqual({
			path: "README.md",
			file_path: "README.md",
		});
	});

	it("leaves inputs that already name file_path, or are not file tools, unchanged", () => {
		const explicit = { path: "a.ts", file_path: "b.ts" };
		expect(toClaudeToolInput("editor", explicit)).toBe(explicit);
		const search = { pattern: "todo" };
		expect(toClaudeToolInput("search_codebase", search)).toBe(search);
		expect(fromClaudeToolInput("read_files", { path: "a" })).toEqual({
			path: "a",
		});
	});

	it("passes malformed shell input through so the tool reports its own error", () => {
		const malformed = { commands: [] };
		expect(toClaudeToolInput("run_commands", malformed)).toBe(malformed);
	});
});

describe("parseClaudeCommandMarkdown", () => {
	it("reads description and argument-hint from frontmatter and keeps the body", () => {
		const parsed = parseClaudeCommandMarkdown(
			"---\ndescription: Review a diff\nargument-hint: <file>\n---\n\nReview $ARGUMENTS carefully.\n",
		);
		expect(parsed).toEqual({
			description: "Review a diff",
			argumentHint: "<file>",
			body: "Review $ARGUMENTS carefully.",
		});
	});

	it("treats a file without frontmatter as a body-only prompt", () => {
		expect(parseClaudeCommandMarkdown("  Just a prompt.  \n")).toEqual({
			body: "Just a prompt.",
		});
	});

	it("handles CRLF line endings and a UTF-8 BOM", () => {
		const parsed = parseClaudeCommandMarkdown(
			"﻿---\r\ndescription: Windows file\r\n---\r\nBody\r\n",
		);
		expect(parsed).toEqual({ description: "Windows file", body: "Body" });
	});

	it("rejects frontmatter that is never closed", () => {
		expect(() =>
			parseClaudeCommandMarkdown("---\ndescription: oops\nbody"),
		).toThrow("Command frontmatter is missing its closing '---' line.");
	});

	it("rejects frontmatter that is not a mapping", () => {
		expect(() =>
			parseClaudeCommandMarkdown("---\n- a\n- b\n---\nbody"),
		).toThrow("Command frontmatter must be a YAML mapping.");
	});
});

describe("renderClaudeCommandPrompt", () => {
	const pluginRoot = "/plugins/kit";

	it("substitutes every $ARGUMENTS placeholder with the trimmed input", () => {
		expect(
			renderClaudeCommandPrompt(
				"Fix $ARGUMENTS, then $ARGUMENTS again.",
				"  bug 42 ",
				{ pluginRoot },
			),
		).toBe("Fix bug 42, then bug 42 again.");
	});

	it("leaves the prompt unchanged when no arguments are given and no placeholder exists", () => {
		expect(
			renderClaudeCommandPrompt("Summarize the repo.", "", { pluginRoot }),
		).toBe("Summarize the repo.");
	});

	it("expands ${CLAUDE_PLUGIN_ROOT} so a bundled script path resolves inside the plugin", () => {
		expect(
			renderClaudeCommandPrompt(
				"run ${CLAUDE_PLUGIN_ROOT}/scripts/te --cwd $ARGUMENTS",
				"config set X=1",
				{ pluginRoot },
			),
		).toBe("run /plugins/kit/scripts/te --cwd config set X=1");
	});
});

describe("parseClaudeSkillMarkdown", () => {
	it("accepts Claude-only frontmatter fields such as disable-model-invocation", () => {
		const parsed = parseClaudeSkillMarkdown(
			"---\nname: hello\ndescription: Greet the user\ndisable-model-invocation: true\n---\nGreet warmly.\n",
			"hello",
		);
		expect(parsed.metadata).toEqual({
			name: "hello",
			description: "Greet the user",
		});
		expect(parsed.frontmatter["disable-model-invocation"]).toBe(true);
		expect(parsed.instructions).toBe("Greet warmly.");
	});

	it("falls back to the directory name when the name field is absent", () => {
		const parsed = parseClaudeSkillMarkdown(
			"---\ndescription: d\n---\nbody",
			"from-dir",
		);
		expect(parsed.metadata.name).toBe("from-dir");
	});

	it("rejects a skill without a description", () => {
		expect(() =>
			parseClaudeSkillMarkdown("---\nname: x\n---\nbody", "x"),
		).toThrow("Frontmatter field 'description' is required.");
	});

	it("rejects a skill with an empty body", () => {
		expect(() =>
			parseClaudeSkillMarkdown("---\nname: x\ndescription: d\n---\n  \n", "x"),
		).toThrow("Skill body is empty.");
	});
});

describe("createClaudeHookBridge placeholder expansion", () => {
	it("expands ${CLAUDE_PLUGIN_ROOT} to a quoted absolute path so a script inside the plugin runs", async () => {
		const root = await realpath(await mkdtemp(join(tmpdir(), "claude-root-")));
		const pluginRoot = join(root, "plugin dir");
		await mkdir(pluginRoot, { recursive: true });
		await writeFile(
			join(pluginRoot, "guard.sh"),
			"#!/bin/sh\necho 'guard from plugin root' >&2\nexit 2\n",
		);
		const hooks = createClaudeHookBridge({
			bindings: [
				{
					event: "PreToolUse",
					command: "sh ${CLAUDE_PLUGIN_ROOT}/guard.sh",
					timeoutSeconds: 5,
					pluginName: "p",
					pluginRoot,
					pluginDataPath: join(root, "data"),
				},
			],
			cwd: root,
		});

		const decision = await hooks?.beforeTool?.({
			snapshot: { agentId: "a", conversationId: "c", messages: [] },
			tool: { name: "run_commands" },
			toolCall: { toolCallId: "t" },
			input: { commands: ["ls"] },
		} as never);

		expect(decision).toEqual({
			skip: true,
			reason: "guard from plugin root",
			appendContext: undefined,
		});
	});
});

describe("PostToolUseFailure routing", () => {
	it("accepts PostToolUseFailure as a supported event with matchers", () => {
		const parsed = parseClaudeHooksDocument({
			hooks: {
				PostToolUseFailure: [
					{ matcher: "Bash", hooks: [{ type: "command", command: "report" }] },
				],
			},
		});
		expect(parsed.problems).toEqual([]);
		expect(parsed.bindings).toEqual([
			{
				event: "PostToolUseFailure",
				matcher: "Bash",
				command: "report",
				timeoutSeconds: 60,
			},
		]);
	});
});
