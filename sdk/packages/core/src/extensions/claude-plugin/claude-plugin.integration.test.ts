// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these tests feed Claude Code's literal ${CLAUDE_PLUGIN_*} placeholders into the loader.
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentBeforeToolContext,
	AgentExtensionCommand,
	AgentRuntimeStateSnapshot,
} from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_PLUGINS_V1_MANIFEST_SCHEMA,
	loadAgentPluginPackages,
} from "../agent-plugin";
import { createClaudePluginExtension } from "./extension";
import { createClaudeHookBridge } from "./hook-bridge";
import { loadClaudePlugins } from "./load";
import type { ClaudePluginHookBinding } from "./types";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function tempRoot(): Promise<string> {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "cline-claude-plugin-")),
	);
	roots.push(root);
	return root;
}

async function createClaudePlugin(
	searchRoot: string,
	name: string,
	files: Record<string, string | object> = {},
): Promise<string> {
	const pluginRoot = join(searchRoot, name);
	await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
	await writeFile(
		join(pluginRoot, ".claude-plugin", "plugin.json"),
		JSON.stringify({ name, description: `${name} plugin` }),
	);
	for (const [path, content] of Object.entries(files)) {
		const target = join(pluginRoot, path);
		await mkdir(join(target, ".."), { recursive: true });
		await writeFile(
			target,
			typeof content === "string" ? content : JSON.stringify(content),
		);
	}
	return pluginRoot;
}

describe("loadClaudePlugins discovery and components", () => {
	it("loads skills, commands, hooks and MCP servers from a Claude plugin with placeholder rewriting", async () => {
		const search = await tempRoot();
		const dataRoot = await tempRoot();
		const pluginRoot = await createClaudePlugin(search, "toolkit", {
			"skills/lint/SKILL.md":
				"---\nname: lint\ndescription: Lint the project\n---\nRun the linter.\n",
			"commands/review.md":
				"---\ndescription: Review changes\n---\nReview $ARGUMENTS now.\n",
			"hooks/hooks.json": {
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [
								{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/guard.sh" },
							],
						},
					],
				},
			},
			".mcp.json": {
				mcpServers: {
					docs: {
						type: "stdio",
						command: "${CLAUDE_PLUGIN_ROOT}/bin/docs-server",
						args: ["--root", "${CLAUDE_PLUGIN_DATA}"],
					},
				},
			},
		});

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: dataRoot,
		});

		expect(report.diagnostics).toEqual([]);
		expect(report.plugins).toHaveLength(1);
		const [plugin] = report.plugins;
		expect(plugin.rootPath).toBe(pluginRoot);
		expect(plugin.manifest.name).toBe("toolkit");
		expect(plugin.skills.map((skill) => skill.metadata.name)).toEqual(["lint"]);
		expect(plugin.commands).toMatchObject([
			{
				runtimeName: "toolkit:review",
				description: "Review changes",
				body: "Review $ARGUMENTS now.",
			},
		]);
		expect(plugin.hooks).toEqual([
			{
				event: "PreToolUse",
				matcher: "Bash",
				command: "${CLAUDE_PLUGIN_ROOT}/guard.sh",
				timeoutSeconds: 60,
				pluginName: "toolkit",
				pluginRoot,
				pluginDataPath: expect.stringMatching(
					new RegExp(`^${dataRoot}/toolkit-[0-9a-f]{12}$`),
				),
			},
		]);
		expect(report.mcpServers).toHaveLength(1);
		expect(report.mcpServers[0].registration).toMatchObject({
			name: "toolkit.docs",
			transport: {
				type: "stdio",
				command: join(pluginRoot, "bin", "docs-server"),
				args: [
					"--root",
					expect.stringMatching(
						new RegExp(`^${dataRoot}/toolkit-[0-9a-f]{12}$`),
					),
				],
			},
		});
	});

	it("rejects a plugin with an invalid manifest name but keeps loading other plugins", async () => {
		const search = await tempRoot();
		await createClaudePlugin(search, "good-one");
		const badRoot = join(search, "bad-one");
		await mkdir(join(badRoot, ".claude-plugin"), { recursive: true });
		await writeFile(
			join(badRoot, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "Bad Name With Spaces" }),
		);

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});

		expect(report.plugins.map((plugin) => plugin.manifest.name)).toEqual([
			"good-one",
		]);
		expect(report.diagnostics).toEqual([
			expect.objectContaining({
				level: "error",
				component: "manifest",
				pluginPath: badRoot,
				message: expect.stringContaining(
					"plugin manifest field 'name' must be 1-64",
				),
			}),
		]);
	});

	it("isolates a broken MCP file so the plugin's skills and hooks still load", async () => {
		const search = await tempRoot();
		await createClaudePlugin(search, "partial", {
			"skills/ok/SKILL.md": "---\nname: ok\ndescription: works\n---\nbody\n",
			"hooks/hooks.json": {
				hooks: { Stop: [{ hooks: [{ type: "command", command: "done" }] }] },
			},
			".mcp.json": "{ not json",
		});

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});

		expect(
			report.plugins[0].skills.map((skill) => skill.metadata.name),
		).toEqual(["ok"]);
		expect(report.plugins[0].hooks.map((hook) => hook.event)).toEqual(["Stop"]);
		expect(report.mcpServers).toEqual([]);
		expect(report.diagnostics).toEqual([
			expect.objectContaining({
				level: "error",
				component: "mcp",
				message: expect.stringContaining("Skipping mcp for this plugin"),
			}),
		]);
	});

	it("gives the first plugin precedence when two roots share a name", async () => {
		const first = await tempRoot();
		const second = await tempRoot();
		const winner = await createClaudePlugin(first, "shared");
		const loser = await createClaudePlugin(second, "shared");

		const report = await loadClaudePlugins({
			pluginPaths: [winner, loser],
			searchPaths: [],
			pluginDataRoot: await tempRoot(),
		});

		expect(report.plugins.map((plugin) => plugin.rootPath)).toEqual([winner]);
		expect(report.diagnostics).toEqual([
			expect.objectContaining({
				level: "warning",
				pluginPath: loser,
				message: `Ignoring duplicate Claude plugin 'shared'; '${winner}' has precedence.`,
			}),
		]);
	});

	it("skips disabled plugins and plugins whose name another loader already claimed", async () => {
		const search = await tempRoot();
		await createClaudePlugin(search, "off");
		await createClaudePlugin(search, "native-owned");
		await createClaudePlugin(search, "on");

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
			disabledPluginNames: ["off"],
			reservedPluginNames: ["native-owned"],
		});

		expect(report.plugins.map((plugin) => plugin.manifest.name)).toEqual([
			"on",
		]);
		expect(report.diagnostics.map((item) => item.message)).toEqual([
			"Skipping Claude plugin 'native-owned': a plugin with the same name is already loaded from another format.",
		]);
	});

	it("reports unsupported and ignored manifest fields without failing the load", async () => {
		const search = await tempRoot();
		const pluginRoot = join(search, "extras");
		await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
		await writeFile(
			join(pluginRoot, ".claude-plugin", "plugin.json"),
			JSON.stringify({
				name: "extras",
				outputStyles: "./styles",
				commands: "./cmds",
				surprise: true,
			}),
		);

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});

		expect(report.plugins).toHaveLength(1);
		expect(report.diagnostics.map((item) => item.message)).toEqual([
			"Manifest field 'outputStyles' is not supported by Cline and is ignored.",
			"Ignoring unknown plugin manifest field 'surprise'.",
		]);
	});

	it("does not treat a native Agent Plugin directory as a Claude plugin", async () => {
		const search = await tempRoot();
		const pluginRoot = join(search, "dual");
		await mkdir(join(pluginRoot, ".claude-plugin"), { recursive: true });
		await writeFile(
			join(pluginRoot, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "dual" }),
		);
		await writeFile(
			join(pluginRoot, "plugin.json"),
			JSON.stringify({
				$schema: AGENT_PLUGINS_V1_MANIFEST_SCHEMA,
				name: "dual",
			}),
		);

		const claude = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});
		const native = await loadAgentPluginPackages({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});

		expect(claude.plugins).toEqual([]);
		expect(native.plugins.map((plugin) => plugin.manifest.name)).toEqual([
			"dual",
		]);
	});

	it("refuses a component path that symlinks outside the plugin root", async () => {
		const search = await tempRoot();
		const outside = await tempRoot();
		await writeFile(
			join(outside, "SKILL.md"),
			"---\nname: escape\ndescription: outside\n---\nx\n",
		);
		const pluginRoot = await createClaudePlugin(search, "linker");
		await mkdir(join(pluginRoot, "skills"), { recursive: true });
		await symlink(outside, join(pluginRoot, "commands"));

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});

		expect(report.plugins[0].commands).toEqual([]);
		expect(report.diagnostics).toEqual([
			expect.objectContaining({
				component: "commands",
				message: expect.stringContaining(
					"path resolves outside the plugin root",
				),
			}),
		]);
	});
});

describe("inventory and custom component paths", () => {
	it("lists disabled plugins in the inventory without loading their components", async () => {
		const search = await tempRoot();
		await createClaudePlugin(search, "on", {
			"skills/a/SKILL.md": "---\nname: a\ndescription: d\n---\nbody\n",
		});
		await createClaudePlugin(search, "off", {
			"skills/b/SKILL.md": "---\nname: b\ndescription: d\n---\nbody\n",
		});

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
			disabledPluginNames: ["off"],
		});

		expect(report.inventory.map((item) => [item.name, item.enabled])).toEqual([
			["off", false],
			["on", true],
		]);
		expect(report.plugins.map((plugin) => plugin.manifest.name)).toEqual([
			"on",
		]);
		expect(report.skills.map((skill) => skill.metadata.name)).toEqual(["a"]);
	});

	it("reads commands from the manifest's declared directory", async () => {
		const search = await tempRoot();
		const pluginRoot = await createClaudePlugin(search, "custom-cmds", {
			"slash-commands/ship.md": "---\ndescription: Ship\n---\nShip it.\n",
		});
		await writeFile(
			join(pluginRoot, ".claude-plugin", "plugin.json"),
			JSON.stringify({ name: "custom-cmds", commands: "./slash-commands/" }),
		);

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});

		expect(report.diagnostics).toEqual([]);
		expect(
			report.plugins[0].commands.map((command) => command.runtimeName),
		).toEqual(["custom-cmds:ship"]);
	});

	it("explains that TypeScript hook modules are unsupported rather than reporting a malformed file", async () => {
		const search = await tempRoot();
		await createClaudePlugin(search, "modular", {
			"hooks/hooks.json": { modules: ["./fast.ts"] },
		});

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});

		expect(report.plugins[0].hooks).toEqual([]);
		expect(report.diagnostics.map((item) => item.message)).toEqual([
			"hooks.json declares TypeScript hook modules, which Cline does not run. Only Claude Code command hooks are supported.",
		]);
	});
});

describe("Claude Code documented example plugin", () => {
	it("loads the first-plugin walkthrough layout: manifest with author, skill with disable-model-invocation", async () => {
		const search = await tempRoot();
		await createClaudePlugin(search, "my-first-plugin", {
			"skills/hello/SKILL.md":
				"---\nname: hello\ndescription: Greet the user with a friendly message\ndisable-model-invocation: true\n---\n\nGreet the user warmly and ask how you can help them today.\n",
		});
		const pluginRoot = join(search, "my-first-plugin");
		await writeFile(
			join(pluginRoot, ".claude-plugin", "plugin.json"),
			JSON.stringify({
				name: "my-first-plugin",
				description: "A greeting plugin to learn the basics",
				version: "1.0.0",
				author: { name: "Your Name" },
			}),
		);

		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});

		expect(report.diagnostics).toEqual([]);
		expect(report.plugins[0].manifest).toEqual({
			name: "my-first-plugin",
			description: "A greeting plugin to learn the basics",
			version: "1.0.0",
			author: { name: "Your Name" },
		});
		expect(report.skills.map((skill) => skill.metadata.name)).toEqual([
			"hello",
		]);
	});

	it("runs the documented lint hook, which reads tool_input.file_path from the edit", async () => {
		const root = await tempRoot();
		const hooks = createClaudeHookBridge({
			bindings: [
				{
					event: "PostToolUse",
					matcher: "Write|Edit",
					command:
						"f=$(jq -r '.tool_input.file_path') && echo \"lint:$f\" >&2 && exit 2",
					timeoutSeconds: 10,
					pluginName: "doc",
					pluginRoot: root,
					pluginDataPath: join(root, "data"),
				},
			],
			cwd: root,
		});

		const result = await hooks?.afterTool?.({
			snapshot: { agentId: "a", conversationId: "c", messages: [] },
			tool: { name: "editor" },
			toolCall: { toolCallId: "t" },
			input: { path: "src/app.ts", new_text: "x" },
			result: { output: "ok" },
		} as never);

		expect(result).toEqual({ appendContext: "lint:src/app.ts" });
	});
});

describe("createClaudePluginExtension", () => {
	it("returns no extension when no plugin contributes hooks or commands", () => {
		expect(
			createClaudePluginExtension({ plugins: [], cwd: "/tmp" }),
		).toBeUndefined();
	});

	it("registers each command under its namespaced runtime name and renders its arguments", async () => {
		const search = await tempRoot();
		await createClaudePlugin(search, "kit", {
			"commands/ship.md":
				"---\ndescription: Ship it\n---\nShip $ARGUMENTS to prod.\n",
		});
		const report = await loadClaudePlugins({
			searchPaths: [search],
			pluginDataRoot: await tempRoot(),
		});
		const extension = createClaudePluginExtension({
			plugins: report.plugins,
			cwd: search,
		});
		expect(extension?.manifest.capabilities).toEqual(["commands"]);

		const registered: AgentExtensionCommand[] = [];
		await extension?.setup?.(
			{
				registerCommand: (command: AgentExtensionCommand) => {
					registered.push(command);
				},
			} as never,
			{},
		);

		expect(registered).toHaveLength(1);
		expect(registered[0]).toMatchObject({
			name: "kit:ship",
			description: "Ship it",
		});
		expect(registered[0].handler?.("v2")).toEqual({
			submitPrompt: "Ship v2 to prod.",
		});
	});
});

describe("hook bridge execution against real commands", () => {
	async function bindingFor(
		pluginRoot: string,
		event: ClaudePluginHookBinding["event"],
		command: string,
		matcher?: string,
	): Promise<ClaudePluginHookBinding> {
		return {
			event,
			...(matcher ? { matcher } : {}),
			command,
			timeoutSeconds: 5,
			pluginName: "test",
			pluginRoot,
			pluginDataPath: join(pluginRoot, "data"),
		};
	}

	function snapshotFixture(
		messages: AgentRuntimeStateSnapshot["messages"] = [],
	): AgentRuntimeStateSnapshot {
		return {
			agentId: "a",
			conversationId: "c",
			status: "running",
			iteration: 1,
			messages,
			pendingToolCalls: [],
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		};
	}

	function toolContext(
		toolName: string,
		input: unknown,
	): AgentBeforeToolContext {
		return {
			snapshot: snapshotFixture(),
			tool: {
				name: toolName,
				description: "",
				inputSchema: {},
				execute: async () => ({ output: "" }),
			},
			toolCall: { type: "tool-call", toolCallId: "t1", toolName, input },
			input,
		} as AgentBeforeToolContext;
	}

	it("skips a tool call when a PreToolUse hook exits with code 2, passing its stderr as the reason", async () => {
		const root = await tempRoot();
		const hooks = createClaudeHookBridge({
			bindings: [
				await bindingFor(
					root,
					"PreToolUse",
					"echo 'rm is forbidden' >&2; exit 2",
					"Bash",
				),
			],
			cwd: root,
		});

		const decision = await hooks?.beforeTool?.(
			toolContext("run_commands", { commands: ["rm -rf /"] }),
		);

		expect(decision).toEqual({
			skip: true,
			reason: "rm is forbidden",
			appendContext: undefined,
		});
	});

	it("honors a JSON deny decision from a PreToolUse hook", async () => {
		const root = await tempRoot();
		const payload = JSON.stringify({
			hookSpecificOutput: {
				permissionDecision: "deny",
				permissionDecisionReason: "policy says no",
			},
		});
		const hooks = createClaudeHookBridge({
			bindings: [
				await bindingFor(root, "PreToolUse", `printf '%s' '${payload}'`),
			],
			cwd: root,
		});

		const decision = await hooks?.beforeTool?.(
			toolContext("editor", { path: "x" }),
		);

		expect(decision).toMatchObject({ skip: true, reason: "policy says no" });
	});

	it("rewrites a shell command through updatedInput and maps it back to Cline's commands shape", async () => {
		const root = await tempRoot();
		const payload = JSON.stringify({
			hookSpecificOutput: { updatedInput: { command: "git status --short" } },
		});
		const hooks = createClaudeHookBridge({
			bindings: [
				await bindingFor(
					root,
					"PreToolUse",
					`printf '%s' '${payload}'`,
					"Bash",
				),
			],
			cwd: root,
		});

		const decision = await hooks?.beforeTool?.(
			toolContext("run_commands", { commands: ["git status"] }),
		);

		expect(decision).toMatchObject({
			input: { commands: ["git status --short"] },
		});
	});

	it("does not run a hook whose matcher excludes the tool", async () => {
		const root = await tempRoot();
		const marker = join(root, "ran.txt");
		const hooks = createClaudeHookBridge({
			bindings: [
				await bindingFor(root, "PreToolUse", `touch ${marker}; exit 2`, "Edit"),
			],
			cwd: root,
		});

		const decision = await hooks?.beforeTool?.(
			toolContext("run_commands", { commands: ["ls"] }),
		);

		expect(decision).toBeUndefined();
		await expect(stat(marker)).rejects.toThrow();
	});

	it("reports a PostToolUse block reason back to the model as appended context", async () => {
		const root = await tempRoot();
		const hooks = createClaudeHookBridge({
			bindings: [
				await bindingFor(
					root,
					"PostToolUse",
					"echo 'secret detected' >&2; exit 2",
					"Edit",
				),
			],
			cwd: root,
		});

		const result = await hooks?.afterTool?.({
			...toolContext("editor", { path: "a.ts" }),
			result: { output: "ok" },
		} as never);

		expect(result).toEqual({ appendContext: "secret detected" });
	});

	it("does not block the run when a hook exits with an unrelated non-zero code", async () => {
		const root = await tempRoot();
		const hooks = createClaudeHookBridge({
			bindings: [await bindingFor(root, "PreToolUse", "exit 1", "Bash")],
			cwd: root,
		});

		const decision = await hooks?.beforeTool?.(
			toolContext("run_commands", { commands: ["ls"] }),
		);

		expect(decision).toBeUndefined();
	});

	it("kills a hook that exceeds its timeout and continues the run", async () => {
		const root = await tempRoot();
		const hooks = createClaudeHookBridge({
			bindings: [
				{
					...(await bindingFor(root, "PreToolUse", "sleep 10", "Bash")),
					timeoutSeconds: 0.2,
				},
			],
			cwd: root,
		});

		const started = Date.now();
		const decision = await hooks?.beforeTool?.(
			toolContext("run_commands", { commands: ["ls"] }),
		);

		expect(decision).toBeUndefined();
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it("injects SessionStart context once and stops the run when UserPromptSubmit blocks", async () => {
		const root = await tempRoot();
		const sessionPayload = JSON.stringify({
			hookSpecificOutput: { additionalContext: "Project uses pnpm." },
		});
		const hooks = createClaudeHookBridge({
			bindings: [
				await bindingFor(
					root,
					"SessionStart",
					`printf '%s' '${sessionPayload}'`,
				),
				await bindingFor(
					root,
					"UserPromptSubmit",
					"echo 'prompt banned' >&2; exit 2",
				),
			],
			cwd: root,
		});
		const snapshot = {
			agentId: "a",
			conversationId: "c",
			messages: [
				{
					id: "m",
					role: "user",
					content: [{ type: "text", text: "hi" }],
					createdAt: 0,
				},
			],
		} as never;

		const first = await hooks?.beforeRun?.({ snapshot } as never);
		const second = await hooks?.beforeRun?.({ snapshot } as never);

		expect(first).toEqual({ stop: true, reason: "prompt banned" });
		expect(second).toEqual({ stop: true, reason: "prompt banned" });
	});

	it("delivers the SessionStart context on the first run only", async () => {
		const root = await tempRoot();
		const payload = JSON.stringify({
			hookSpecificOutput: { additionalContext: "Only once." },
		});
		const hooks = createClaudeHookBridge({
			bindings: [
				await bindingFor(root, "SessionStart", `printf '%s' '${payload}'`),
			],
			cwd: root,
		});
		const snapshot = {
			agentId: "a",
			conversationId: "c",
			messages: [],
		} as never;

		expect(await hooks?.beforeRun?.({ snapshot } as never)).toEqual({
			appendContext: "Only once.",
		});
		expect(await hooks?.beforeRun?.({ snapshot } as never)).toBeUndefined();
	});
});
