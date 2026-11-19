// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these tests feed Claude Code's literal ${CLAUDE_PLUGIN_ROOT} placeholder into the agent parser.
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseClaudeAgentMarkdown } from "./agents";
import { loadClaudePlugins } from "./load";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function tempRoot(): Promise<string> {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "cline-claude-agents-")),
	);
	roots.push(root);
	return root;
}

function parse(
	content: string,
	overrides: Partial<{ subfolders: string[]; fileName: string }> = {},
) {
	return parseClaudeAgentMarkdown(content, {
		pluginName: "demo",
		pluginRoot: "/plugins/demo",
		fileName: overrides.fileName ?? "reviewer",
		subfolders: overrides.subfolders ?? [],
	});
}

describe("parseClaudeAgentMarkdown", () => {
	it("maps Claude tool names to Cline tools and warns about the ones it cannot give", () => {
		const { config, warnings } = parse(
			[
				"---",
				"name: reviewer",
				"description: Reviews diffs",
				"tools: Read, Grep, Agent, Bash",
				"---",
				"Review the change.",
			].join("\n"),
		);

		expect(config.name).toBe("demo:reviewer");
		expect(config.tools).toEqual([
			"read_files",
			"search_codebase",
			"run_commands",
		]);
		expect(warnings).toEqual([
			"Tool 'Agent' has no Cline equivalent and is not available to this agent.",
		]);
	});

	it("leaves tools undefined when the frontmatter omits them, so the agent inherits every tool", () => {
		const { config, warnings } = parse(
			"---\nname: reviewer\ndescription: d\n---\nBody.",
		);

		expect(config.tools).toBeUndefined();
		expect(warnings).toEqual([]);
	});

	it("removes disallowed tools from an explicit tool list", () => {
		const { config } = parse(
			[
				"---",
				"description: d",
				"tools: Read, Edit, Bash",
				"disallowedTools: Bash",
				"---",
				"Body.",
			].join("\n"),
		);

		expect(config.tools).toEqual(["read_files", "editor"]);
	});

	it("warns that disallowedTools cannot narrow an inherited tool set", () => {
		const { config, warnings } = parse(
			"---\ndescription: d\ndisallowedTools: Bash\n---\nBody.",
		);

		expect(config.tools).toBeUndefined();
		expect(warnings).toEqual([
			"disallowedTools is only applied together with tools; this agent inherits every tool.",
		]);
	});

	it("uses the session model for a model alias and says so, rather than passing the alias to a provider", () => {
		const { config, warnings } = parse(
			"---\ndescription: d\nmodel: sonnet\n---\nBody.",
		);

		expect(config.modelId).toBeUndefined();
		expect(warnings).toEqual([
			"model 'sonnet' is not mapped; this agent uses the session model.",
		]);
	});

	it("treats model inherit as the session model without a warning", () => {
		const { warnings } = parse(
			"---\ndescription: d\nmodel: inherit\n---\nBody.",
		);

		expect(warnings).toEqual([]);
	});

	it("maps maxTurns to the iteration limit and rejects a non-positive value", () => {
		expect(
			parse("---\ndescription: d\nmaxTurns: 7\n---\nBody.").config
				.maxIterations,
		).toBe(7);

		const invalid = parse("---\ndescription: d\nmaxTurns: 0\n---\nBody.");
		expect(invalid.config.maxIterations).toBeUndefined();
		expect(invalid.warnings).toEqual([
			"maxTurns must be a positive integer; '0' is ignored.",
		]);
	});

	it("names the agent after its subfolders and file when the frontmatter name is absent", () => {
		const { config } = parse("---\ndescription: d\n---\nBody.", {
			subfolders: ["review"],
			fileName: "security",
		});

		expect(config.name).toBe("demo:review:security");
	});

	it("uses the frontmatter name in place of the file name but keeps the subfolders", () => {
		const { config } = parse("---\nname: audit\ndescription: d\n---\nBody.", {
			subfolders: ["review"],
			fileName: "security",
		});

		expect(config.name).toBe("demo:review:audit");
	});

	it("gives a description fallback when the field is missing", () => {
		const { config } = parse("---\nname: reviewer\n---\nBody.");

		expect(config.description).toBe("Agent from demo plugin");
	});

	it("substitutes the plugin root placeholder in the system prompt", () => {
		const { config } = parse(
			"---\ndescription: d\n---\nRun ${CLAUDE_PLUGIN_ROOT}/scripts/check.sh.",
		);

		expect(config.systemPrompt).toBe(
			"Run /plugins/demo/scripts/check.sh.",
		);
	});

	it("reports each Claude field Cline does not enforce instead of silently dropping it", () => {
		const { warnings } = parse(
			[
				"---",
				"description: d",
				"permissionMode: acceptEdits",
				"isolation: worktree",
				"hooks:",
				"  PreToolUse: []",
				"---",
				"Body.",
			].join("\n"),
		);

		expect(warnings).toEqual([
			"Agent field 'permissionMode' is not supported by Cline and is ignored.",
			"Agent field 'hooks' is not supported by Cline and is ignored.",
			"Agent field 'isolation' is not supported by Cline and is ignored.",
		]);
	});

	it("passes the listed skills through to the agent", () => {
		const { config } = parse(
			"---\ndescription: d\nskills:\n  - lint\n  - format\n---\nBody.",
		);

		expect(config.skills).toEqual(["lint", "format"]);
	});

	it("rejects an agent with an empty body, because the body is its system prompt", () => {
		expect(() => parse("---\ndescription: d\n---\n   \n")).toThrow(
			"Agent body is empty; it is used as the system prompt.",
		);
	});

	it("rejects a file without frontmatter", () => {
		expect(() => parse("Just a prompt.")).toThrow(
			"Agent file must start with YAML frontmatter delimited by '---'.",
		);
	});
});

describe("loadClaudePlugins agents", () => {
	it("loads agents from agents/ recursively with plugin-scoped names, and skips disabled plugins", async () => {
		const searchRoot = await tempRoot();
		const pluginRoot = join(searchRoot, "demo");
		await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
		await mkdir(join(pluginRoot, "agents", "review"), { recursive: true });
		await writeFile(
			join(pluginRoot, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "demo" }),
		);
		await writeFile(
			join(pluginRoot, "agents", "planner.md"),
			"---\ndescription: Plans work\ntools: Read\n---\nPlan it.",
		);
		await writeFile(
			join(pluginRoot, "agents", "review", "security.md"),
			"---\ndescription: Finds auth gaps\n---\nAudit auth.",
		);

		const enabled = await loadClaudePlugins({
			searchPaths: [searchRoot],
			pluginDataRoot: join(searchRoot, "data"),
		});
		expect(enabled.agents.map((agent) => agent.name)).toEqual([
			"demo:planner",
			"demo:review:security",
		]);
		expect(enabled.agents[0]?.tools).toEqual(["read_files"]);
		expect(enabled.plugins[0]?.agents).toHaveLength(2);

		const disabled = await loadClaudePlugins({
			searchPaths: [searchRoot],
			pluginDataRoot: join(searchRoot, "data"),
			disabledPluginNames: ["demo"],
		});
		expect(disabled.agents).toEqual([]);
	});

	it("loads only the file named by the manifest agents field, without subfolder names", async () => {
		const searchRoot = await tempRoot();
		const pluginRoot = join(searchRoot, "custom");
		await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
		await mkdir(join(pluginRoot, "custom", "review"), { recursive: true });
		await mkdir(join(pluginRoot, "agents"), { recursive: true });
		await writeFile(
			join(pluginRoot, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "custom", agents: "./custom/review/security.md" }),
		);
		await writeFile(
			join(pluginRoot, "custom", "review", "security.md"),
			"---\ndescription: d\n---\nAudit.",
		);
		await writeFile(
			join(pluginRoot, "agents", "ignored.md"),
			"---\ndescription: d\n---\nIgnored.",
		);

		const report = await loadClaudePlugins({
			searchPaths: [searchRoot],
			pluginDataRoot: join(searchRoot, "data"),
		});

		expect(report.agents.map((agent) => agent.name)).toEqual(["custom:security"]);
	});

	it("skips an agent file that symlinks outside the plugin and keeps the others", async () => {
		const searchRoot = await tempRoot();
		const outside = await tempRoot();
		const pluginRoot = join(searchRoot, "linked");
		await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
		await mkdir(join(pluginRoot, "agents"), { recursive: true });
		await writeFile(
			join(pluginRoot, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "linked" }),
		);
		await writeFile(join(outside, "host.md"), "---\ndescription: d\n---\nHost.");
		await symlink(join(outside, "host.md"), join(pluginRoot, "agents", "host.md"));
		await writeFile(
			join(pluginRoot, "agents", "local.md"),
			"---\ndescription: d\n---\nLocal.",
		);

		const report = await loadClaudePlugins({
			searchPaths: [searchRoot],
			pluginDataRoot: join(searchRoot, "data"),
		});

		expect(report.agents.map((agent) => agent.name)).toEqual(["linked:local"]);
		expect(
			report.diagnostics.some(
				(item) =>
					item.component === "agents" &&
					item.level === "error" &&
					item.message.startsWith("Skipping agent:"),
			),
		).toBe(true);
	});
});
