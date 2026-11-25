import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
	AgentExtensionCommand,
	BasicLogger,
	ContentBlock,
	MessageWithMetadata,
	ToolResultContent,
} from "@cline/shared";
import type {
	CoreCompactionContext,
	CoreCompactionResult,
} from "../../types/config";
import { markPluginCommand } from "../plugin/plugin-command-origin";
import { importPluginModule } from "../plugin/plugin-module-import";
import type { ClaudePluginHookModule } from "./types";

const MAX_PROCESS_OUTPUT_BYTES = 32 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 120_000;

interface SessionToolUse {
	tool_use_id: string;
	tool: string;
	input: unknown;
	text?: string;
	isError?: boolean;
}

interface SessionToolResult {
	tool_use_id: string;
	text: string;
	isError: boolean;
}

interface SessionMessage {
	role: "user" | "assistant";
	text: string;
	toolUses: SessionToolUse[];
	toolResults?: SessionToolResult[];
	handle?: string;
}

interface CompactInput {
	trigger: string;
	instructions?: string;
	messages: readonly SessionMessage[];
}

type Next<T> = (event: T) => Promise<unknown> | unknown;
type Handler = (
	context: Record<string, unknown>,
	event: never,
	next: Next<never>,
) => Promise<unknown> | unknown;

interface RegisteredHandler {
	event: string;
	command?: string;
	handler: Handler;
}

interface CommandRegistration {
	name: string;
	description?: string;
	argumentHint?: string;
}

export interface ClaudeFunctionHooks {
	commands: AgentExtensionCommand[];
	preCompact?: (
		context: CoreCompactionContext,
	) => Promise<CoreCompactionResult | undefined>;
}

export interface CreateClaudeFunctionHooksOptions {
	modules: ReadonlyArray<ClaudePluginHookModule>;
	cwd: string;
	logger?: BasicLogger;
}

/**
 * Run Claude Code function-hook modules (`hooks.json` `modules`) on Cline.
 *
 * Supported surface: `session.compact` becomes Cline's `preCompact`,
 * `session.start` and `command.run` back plugin slash commands, and the `$`
 * context provides `http`, `env`, `settings`, `fs`, `process`, `ui`, `command`
 * and `session.cwd`. Handlers for other events are ignored; any other `$` member
 * throws when a hook touches it, so the plugin falls back instead of silently
 * misbehaving. A module that fails to load is logged and skipped.
 */
export async function createClaudeFunctionHooks(
	options: CreateClaudeFunctionHooksOptions,
): Promise<ClaudeFunctionHooks> {
	const commands: AgentExtensionCommand[] = [];
	const compactHandlers: Array<{
		module: ClaudePluginHookModule;
		handler: Handler;
	}> = [];

	for (const module of options.modules) {
		try {
			const handlers = await registerModule(module);
			const runtime = createRuntimeContext(module, options);
			const registrations = new Map<string, CommandRegistration>();
			const startContext = {
				...runtime,
				command: {
					register: async (registration: CommandRegistration) => {
						registrations.set(registration.name, registration);
					},
				},
			};
			for (const entry of handlers.filter((h) => h.event === "session.start")) {
				await entry.handler(startContext, {} as never, async (event) => event);
			}
			for (const registration of registrations.values()) {
				commands.push(
					markPluginCommand(
						toCommand(registration, handlers, runtime, module, options.logger),
					),
				);
			}
			for (const entry of handlers.filter(
				(h) => h.event === "session.compact",
			)) {
				compactHandlers.push({ module, handler: entry.handler });
			}
		} catch (error) {
			options.logger?.log(
				`[claude-plugins] ${module.pluginName} function-hook module '${module.modulePath}' failed to load: ${errorMessage(error)}`,
				{ severity: "warn" },
			);
		}
	}

	return {
		commands,
		...(compactHandlers.length > 0
			? { preCompact: createPreCompact(compactHandlers, options) }
			: {}),
	};
}

async function registerModule(
	module: ClaudePluginHookModule,
): Promise<RegisteredHandler[]> {
	const exports = await importPluginModule(module.modulePath);
	const register = (exports.register ??
		(exports.default as Record<string, unknown> | undefined)?.register ??
		exports.default) as unknown;
	if (typeof register !== "function") {
		throw new Error("module does not export a register(on, options) function");
	}
	const handlers: RegisteredHandler[] = [];
	const on = (
		event: string,
		matcherOrHandler: unknown,
		maybeHandler?: unknown,
	): void => {
		const handler = (
			typeof matcherOrHandler === "function" ? matcherOrHandler : maybeHandler
		) as Handler | undefined;
		if (typeof handler !== "function") {
			return;
		}
		const matcher =
			typeof matcherOrHandler === "object" && matcherOrHandler !== null
				? (matcherOrHandler as { command?: unknown }).command
				: undefined;
		handlers.push({
			event,
			...(typeof matcher === "string" ? { command: matcher } : {}),
			handler,
		});
	};
	await register(on, module.options);
	return handlers;
}

function toCommand(
	registration: CommandRegistration,
	handlers: ReadonlyArray<RegisteredHandler>,
	runtime: Record<string, unknown>,
	module: ClaudePluginHookModule,
	logger: BasicLogger | undefined,
): AgentExtensionCommand {
	return {
		name: registration.name,
		...(registration.description
			? { description: registration.description }
			: {}),
		handler: async (input) => {
			const handler = handlers.find(
				(entry) =>
					entry.event === "command.run" && entry.command === registration.name,
			);
			if (!handler) {
				return `Command '${registration.name}' has no handler.`;
			}
			try {
				const result = (await handler.handler(
					runtime,
					{ command: registration.name, args: input } as never,
					async (event) => event,
				)) as { text?: unknown } | undefined;
				return typeof result?.text === "string" && result.text
					? { reply: result.text }
					: { reply: `/${registration.name} finished.` };
			} catch (error) {
				logger?.log(
					`[claude-plugins] ${module.pluginName} /${registration.name} failed: ${errorMessage(error)}`,
					{
						severity: "warn",
					},
				);
				return {
					reply: `/${registration.name} failed: ${errorMessage(error)}`,
				};
			}
		},
	};
}

function createPreCompact(
	entries: ReadonlyArray<{ module: ClaudePluginHookModule; handler: Handler }>,
	options: CreateClaudeFunctionHooksOptions,
): NonNullable<ClaudeFunctionHooks["preCompact"]> {
	return async (context) => {
		let messages = context.messages;
		let changed = false;
		for (const { module, handler } of entries) {
			const input: CompactInput = {
				trigger: context.mode === "manual" ? "manual" : "auto",
				messages: toSessionMessages(messages),
			};
			let fellBack = false;
			const result = (await handler(
				createRuntimeContext(module, options),
				input as never,
				async () => {
					fellBack = true;
					return { skip: true };
				},
			)) as
				| { messages?: readonly SessionMessage[]; skip?: unknown }
				| undefined;
			if (fellBack || !result?.messages) {
				continue;
			}
			messages = fromSessionMessages(result.messages, messages);
			changed = true;
		}
		return changed ? { messages } : undefined;
	};
}

function createRuntimeContext(
	module: ClaudePluginHookModule,
	options: CreateClaudeFunctionHooksOptions,
): Record<string, unknown> {
	const cwd = options.cwd;
	const log = (text: string) =>
		options.logger?.log(`[claude-plugins] ${module.pluginName}: ${text}`);
	const supported: Record<string, unknown> = {
		http: {
			fetch: async (
				url: string,
				init?: {
					method?: string;
					headers?: Record<string, string>;
					body?: string;
				},
			) => {
				const response = await fetch(url, init);
				return {
					status: response.status,
					ok: response.ok,
					text: await response.text(),
				};
			},
		},
		env: { get: async (name: string) => process.env[name] },
		settings: { read: () => readClaudeSettings() },
		fs: {
			read: (path: string) => readFile(resolve(cwd, path), "utf8"),
			write: (path: string, text: string) =>
				writeFile(resolve(cwd, path), text, "utf8"),
		},
		process: {
			run: (argv: readonly string[]) => runProcess(argv, cwd),
		},
		ui: {
			log,
			toast: log,
		},
		session: { cwd: async () => cwd },
	};
	return new Proxy(supported, {
		get(target, property) {
			if (typeof property === "string" && !(property in target)) {
				throw new Error(
					`'$.${property}' is not available when running Claude function hooks on Cline.`,
				);
			}
			return Reflect.get(target, property);
		},
	});
}

async function readClaudeSettings(): Promise<Record<string, unknown>> {
	try {
		const parsed: unknown = JSON.parse(
			await readFile(join(homedir(), ".claude", "settings.json"), "utf8"),
		);
		return typeof parsed === "object" && parsed !== null
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function runProcess(
	argv: readonly string[],
	cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const [command, ...args] = argv;
	return new Promise((resolvePromise) => {
		execFile(
			command,
			args,
			{
				cwd,
				maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
				timeout: PROCESS_TIMEOUT_MS,
			},
			(error, stdout, stderr) => {
				const code = (error as { code?: unknown } | null)?.code;
				resolvePromise({
					exitCode: error ? (typeof code === "number" ? code : 1) : 0,
					stdout,
					stderr: error && !stderr ? error.message : stderr,
				});
			},
		);
	});
}

function blockText(content: ToolResultContent["content"]): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function toSessionMessages(
	messages: ReadonlyArray<MessageWithMetadata>,
): SessionMessage[] {
	return messages.map((message, index) => {
		const blocks: ContentBlock[] = Array.isArray(message.content)
			? message.content
			: [];
		const text =
			typeof message.content === "string"
				? message.content
				: blocks
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n");
		const toolUses: SessionToolUse[] = [];
		const toolResults: SessionToolResult[] = [];
		for (const block of blocks) {
			if (block.type === "tool_use") {
				toolUses.push({
					tool_use_id: block.id,
					tool: block.name,
					input: block.input,
				});
			} else if (block.type === "tool_result") {
				toolResults.push({
					tool_use_id: block.tool_use_id,
					text: blockText(block.content),
					isError: block.is_error ?? false,
				});
			}
		}
		return {
			role: message.role as "user" | "assistant",
			text,
			toolUses,
			...(toolResults.length > 0 ? { toolResults } : {}),
			handle: String(index),
		};
	});
}

/**
 * Map a hook's answer back onto Cline messages. A message that still carries its
 * handle is the original object. A rebuilt message keeps the original tool_use
 * blocks by id so provider-specific fields survive, and takes tool_result text
 * from the hook because truncation is the point.
 */
function fromSessionMessages(
	output: readonly SessionMessage[],
	original: ReadonlyArray<MessageWithMetadata>,
): MessageWithMetadata[] {
	const toolUseBlocks = new Map<string, ContentBlock>();
	const toolResultBlocks = new Map<string, ToolResultContent>();
	for (const message of original) {
		if (!Array.isArray(message.content)) {
			continue;
		}
		for (const block of message.content) {
			if (block.type === "tool_use") {
				toolUseBlocks.set(block.id, block);
			} else if (block.type === "tool_result") {
				toolResultBlocks.set(block.tool_use_id, block);
			}
		}
	}
	return output.map((message) => {
		const index = message.handle === undefined ? NaN : Number(message.handle);
		const own = Number.isInteger(index) ? original[index] : undefined;
		if (own) {
			return own;
		}
		const content: ContentBlock[] = [];
		if (message.text) {
			content.push({ type: "text", text: message.text });
		}
		for (const use of message.toolUses) {
			content.push(
				toolUseBlocks.get(use.tool_use_id) ?? {
					type: "tool_use",
					id: use.tool_use_id,
					name: use.tool,
					input: (use.input ?? {}) as Record<string, unknown>,
				},
			);
		}
		for (const result of message.toolResults ?? []) {
			const source = toolResultBlocks.get(result.tool_use_id);
			content.push({
				name:
					toolUseBlocks.get(result.tool_use_id)?.type === "tool_use"
						? (toolUseBlocks.get(result.tool_use_id) as { name: string }).name
						: "",
				...source,
				type: "tool_result",
				tool_use_id: result.tool_use_id,
				content: result.text,
				...(result.isError ? { is_error: true } : {}),
			});
		}
		return { role: message.role, content };
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
