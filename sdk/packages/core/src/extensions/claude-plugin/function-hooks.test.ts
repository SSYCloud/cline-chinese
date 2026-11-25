import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageWithMetadata } from "@cline/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { CoreCompactionContext } from "../../types/config";
import { createClaudeFunctionHooks } from "./function-hooks";
import type { ClaudePluginHookModule } from "./types";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

async function writeModule(source: string): Promise<{
	module: ClaudePluginHookModule;
	root: string;
}> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "cline-fn-hooks-")));
	roots.push(root);
	await mkdir(join(root, "hooks"), { recursive: true });
	const modulePath = join(root, "hooks", "mod.mjs");
	await writeFile(modulePath, source);
	return {
		root,
		module: {
			pluginName: "demo",
			pluginRoot: root,
			pluginDataPath: join(root, "data"),
			modulePath,
			options: { threshold: 0.4 },
		},
	};
}

function context(messages: MessageWithMetadata[]): CoreCompactionContext {
	return { messages, mode: "auto" } as unknown as CoreCompactionContext;
}

const conversation: MessageWithMetadata[] = [
	{ role: "user", content: "fix it" },
	{
		role: "assistant",
		content: [
			{ type: "tool_use", id: "t1", name: "read_file", input: { p: 1 } },
		],
	},
	{
		role: "user",
		content: [
			{ type: "tool_result", name: "read_file", tool_use_id: "t1", content: "A".repeat(50) },
		],
	},
	{ role: "assistant", content: "done" },
];

describe("createClaudeFunctionHooks", () => {
	it("turns a session.compact result into preCompact messages, truncating a tool result and removing a dropped call", async () => {
		const { module } = await writeModule(`
			export const register = (on, options) => {
				on("session.compact", async ($, event) => {
					const messages = event.messages
						.filter((m) => !m.toolUses.some((u) => u.tool_use_id === "t1"))
						.map((m) =>
							m.toolResults
								? { ...m, handle: undefined, toolResults: [{ ...m.toolResults[0], text: "A".repeat(options.threshold * 10) }] }
								: m,
						);
					return { messages };
				});
			};
		`);
		const hooks = await createClaudeFunctionHooks({
			modules: [module],
			cwd: module.pluginRoot,
		});

		const result = await hooks.preCompact?.(context(conversation));

		expect(result?.messages).toHaveLength(3);
		expect(result?.messages[0]).toBe(conversation[0]);
		expect(result?.messages[1]).toEqual({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "t1",
					name: "read_file",
					content: "AAAA",
				},
			],
		});
		expect(result?.messages[2]).toBe(conversation[3]);
	});

	it("returns undefined when the module defers to the built-in summary through next", async () => {
		const { module } = await writeModule(`
			export const register = (on) => {
				on("session.compact", async ($, event, next) => next(event));
			};
		`);
		const hooks = await createClaudeFunctionHooks({
			modules: [module],
			cwd: module.pluginRoot,
		});

		expect(await hooks.preCompact?.(context(conversation))).toBeUndefined();
	});

	it("registers slash commands on session.start and runs their command.run handler with the typed args", async () => {
		const { module, root } = await writeModule(`
			export const register = (on) => {
				on("session.start", async ($, event, next) => {
					await $.command.register({ name: "prune-tests", description: "Prune tests" });
					return next(event);
				});
				on("command.run", { command: "prune-tests" }, async ($, event) => {
					await $.fs.write("out.txt", "args=" + event.args);
					return { text: "pruned " + event.args };
				});
			};
		`);
		const hooks = await createClaudeFunctionHooks({
			modules: [module],
			cwd: root,
		});

		expect(hooks.commands.map((c) => [c.name, c.description])).toEqual([
			["prune-tests", "Prune tests"],
		]);
		const reply = await hooks.commands[0].handler?.("all");

		expect(reply).toEqual({ reply: "pruned all" });
		expect(await readFile(join(root, "out.txt"), "utf8")).toBe("args=all");
	});

	it("reports an unsupported $ member as a command failure instead of crashing", async () => {
		const { module } = await writeModule(`
			export const register = (on) => {
				on("session.start", async ($, event, next) => {
					await $.command.register({ name: "x" });
					return next(event);
				});
				on("command.run", { command: "x" }, async ($) => {
					$.mcp.call("a", "b");
					return { text: "unreachable" };
				});
			};
		`);
		const hooks = await createClaudeFunctionHooks({
			modules: [module],
			cwd: module.pluginRoot,
		});

		const reply = await hooks.commands[0].handler?.("");

		expect(reply).toEqual({
			reply:
				"/x failed: '$.mcp' is not available when running Claude function hooks on Cline.",
		});
	});

	it("skips a module without register() and keeps loading the others", async () => {
		const bad = await writeModule("export const other = 1;");
		const good = await writeModule(`
			export const register = (on) => {
				on("session.compact", async ($, event, next) => next(event));
			};
		`);
		const logged: string[] = [];
		const hooks = await createClaudeFunctionHooks({
			modules: [bad.module, good.module],
			cwd: good.root,
			logger: { log: (message: string) => void logged.push(message) } as never,
		});

		expect(hooks.preCompact).toBeDefined();
		expect(logged).toHaveLength(1);
		expect(logged[0]).toContain("does not export a register");
	});
});
