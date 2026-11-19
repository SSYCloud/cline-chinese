import { spawn } from "node:child_process";

const CLAUDE_CLI_COMMAND = "claude";
const CLI_TIMEOUT_MS = 120_000;
const MAX_CLI_OUTPUT_CHARS = 4_000_000;

export interface ClaudeAvailablePlugin {
	pluginId: string;
	name: string;
	description?: string;
	marketplaceName: string;
	installCount?: number;
}

export interface ClaudeInstalledPluginRecord {
	id: string;
	version?: string;
	enabled: boolean;
	installPath?: string;
}

export interface ClaudeCatalogSnapshot {
	available: ClaudeAvailablePlugin[];
	installed: ClaudeInstalledPluginRecord[];
}

export interface ClaudePluginInstallOutcome {
	pluginId: string;
	installed: boolean;
	message: string;
	failureCode?: string;
}

export class ClaudeCliError extends Error {
	constructor(
		message: string,
		readonly code: "unavailable" | "failed" | "invalid-output",
	) {
		super(message);
		this.name = "ClaudeCliError";
	}
}

/**
 * Thin, typed wrapper over `claude plugin ... --json`. Claude Code owns its
 * plugin store and registry, so installs go through its CLI instead of writing
 * into `~/.claude` directly.
 */
export async function listClaudeMarketplaceCatalog(): Promise<ClaudeCatalogSnapshot> {
	const output = await runClaudeCli([
		"plugin",
		"list",
		"--available",
		"--json",
	]);
	const document = parseJsonObject(output, "plugin list");
	return {
		available: readArray(document.available).flatMap(toAvailablePlugin),
		installed: readArray(document.installed).flatMap(toInstalledRecord),
	};
}

/**
 * Install a plugin from a configured marketplace. Plugins whose install runs a
 * marketplace-declared command are refused here: that command needs an explicit
 * confirmation a person makes, which this call does not carry.
 */
export async function installClaudePlugin(
	pluginId: string,
): Promise<ClaudePluginInstallOutcome> {
	const id = pluginId.trim();
	if (!/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/.test(id)) {
		throw new ClaudeCliError(
			`Invalid Claude plugin id '${pluginId}'.`,
			"failed",
		);
	}
	const output = await runClaudeCli(["plugin", "install", id, "--json"], {
		allowNonZero: true,
	});
	const document = parseJsonObject(output, "plugin install");
	const outcome = typeof document.outcome === "string" ? document.outcome : "";
	const message = typeof document.message === "string" ? document.message : "";
	if (outcome === "ok") {
		return { pluginId: id, installed: true, message };
	}
	return {
		pluginId: id,
		installed: false,
		message: message || `Claude Code could not install ${id}.`,
		failureCode:
			typeof document.failureCode === "string"
				? document.failureCode
				: undefined,
	};
}

function toAvailablePlugin(value: unknown): ClaudeAvailablePlugin[] {
	if (
		!isRecord(value) ||
		typeof value.pluginId !== "string" ||
		typeof value.name !== "string"
	) {
		return [];
	}
	return [
		{
			pluginId: value.pluginId,
			name: value.name,
			marketplaceName:
				typeof value.marketplaceName === "string" ? value.marketplaceName : "",
			...(typeof value.description === "string"
				? { description: value.description }
				: {}),
			...(typeof value.installCount === "number"
				? { installCount: value.installCount }
				: {}),
		},
	];
}

function toInstalledRecord(value: unknown): ClaudeInstalledPluginRecord[] {
	if (!isRecord(value) || typeof value.id !== "string") {
		return [];
	}
	return [
		{
			id: value.id,
			enabled: value.enabled === true,
			...(typeof value.version === "string" ? { version: value.version } : {}),
			...(typeof value.installPath === "string"
				? { installPath: value.installPath }
				: {}),
		},
	];
}

function parseJsonObject(
	output: string,
	command: string,
): Record<string, unknown> {
	const trimmed = output.trim();
	const start = trimmed.indexOf("{");
	let parsed: unknown;
	try {
		parsed = JSON.parse(start >= 0 ? trimmed.slice(start) : trimmed);
	} catch {
		throw new ClaudeCliError(
			`Claude Code returned unreadable output for '${command}'.`,
			"invalid-output",
		);
	}
	if (!isRecord(parsed)) {
		throw new ClaudeCliError(
			`Claude Code returned an unexpected result for '${command}'.`,
			"invalid-output",
		);
	}
	return parsed;
}

function readArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runClaudeCli(
	args: string[],
	options: { allowNonZero?: boolean } = {},
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(CLAUDE_CLI_COMMAND, args, {
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
		}, CLI_TIMEOUT_MS);
		child.stdout.on("data", (chunk: Buffer) => {
			if (stdout.length < MAX_CLI_OUTPUT_CHARS)
				stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < MAX_CLI_OUTPUT_CHARS)
				stderr += chunk.toString("utf8");
		});
		child.once("error", (error: NodeJS.ErrnoException) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(
				error.code === "ENOENT"
					? new ClaudeCliError(
							"Claude Code CLI ('claude') was not found on PATH.",
							"unavailable",
						)
					: error,
			);
		});
		child.once("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (code === 0 || options.allowNonZero) {
				resolve(stdout);
				return;
			}
			reject(
				new ClaudeCliError(
					stderr.trim() || `claude ${args.join(" ")} exited with code ${code}.`,
					"failed",
				),
			);
		});
	});
}
