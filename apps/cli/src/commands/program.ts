import { Command, CommanderError, Option } from "commander";
import { version } from "../../package.json";
import { CLI_DEFAULT_MAX_CONSECUTIVE_MISTAKES } from "../runtime/defaults";
import {
	CLI_COMPACTION_MODE_OPTION_DESCRIPTION,
	parseCliCompactionMode,
} from "../utils/compaction-mode";
import type { ParsedArgs } from "../utils/types";

export { CommanderError };

function normalizeAutoApproveValue(
	value: string | boolean | undefined,
): string {
	if (value === undefined || value === true) {
		return "true";
	}
	return String(value);
}

/**
 * Add the shared root-level options to any command.
 */
export function addRootOptions(cmd: Command): Command {
	return (
		cmd
			.option("-p, --plan", "Run in plan mode")
			.option(
				"-y, --yolo",
				"Auto-approve a limited tool set for unsupervised runs (benchmarks, CI). DANGEROUS: use only in sandboxed environments.",
			)
			.option("--json", "Output messages as JSON instead of styled text")
			.option(
				"--auto-approve <boolean>",
				"为所有工具设置工具自动批准（默认：true）",
				normalizeAutoApproveValue,
			)
			.option("-c, --cwd <path>", "工作目录")
			.option(
				"--thinking <level>",
				"Set reasoning effort: none|low|medium|high|xhigh. Bare --thinking uses medium; omitted uses the level last chosen with /model, or the provider default.",
			)
			.option("--compaction <mode>", CLI_COMPACTION_MODE_OPTION_DESCRIPTION)
			.option(
				"-i, --tui",
				"为交互式会话打开终端用户界面（TUI）",
			)
			.option("--id <session-id>", "Resume an existing session by ID")
			.option("-P, --provider <id>", "Provider id (default: cline)")
			.option(
				"-k, --key <api-key>",
				"API key for this run, also saved as the provider's key",
			)
			.option(
				"-m, --model <model-id>",
				"用于所选提供方会话的模型",
			)
			.option(
				"-s, --system <system-prompt>",
				"覆盖默认系统提示",
			)
			.option("-z, --zen", "在后台 hub 中启动一个会话")
			.option(
				"--retries <count>",
				`Number of maximum consecutive mistakes (retries) before exiting (default: ${CLI_DEFAULT_MAX_CONSECUTIVE_MISTAKES})`,
			)
			.option(
				"-t, --timeout <seconds>",
				"可选的超时秒数（默认：0 表示无超时）",
			)
			.option(
				"--acp",
				"以 Agent Client Protocol（ACP）模式运行以集成编辑器",
			)
			.option("--config <path>", "配置目录（默认：~/.cline）")
			.option(
				"--data-dir <path>",
				"在此目录路径使用隔离的本地状态（默认：~/.cline/data）",
			)
			.option(
				"--hooks-dir <path>",
				"用于运行时钩子注入的附加钩子目录路径（默认：~/.cline/hooks）",
			)
			.option(
				"--worktree",
				"在 ~/.cline/worktrees/ 下自动创建分离的 git worktree 并在其中运行任务",
			)
			.option("--update", "检查更新并在可用时安装")
			.option("--kanban", "运行 kanban 应用")
			.option("-v, --verbose", "显示详细输出")
			// HIDDEN/LEGACY OPTIONS BELOW
			.addOption(
				// Act mode is the default. Keep the legacy flags accepted for users who
				// still pass them, but do not advertise them in help output.
				new Option("-a, --act", "以执行模式运行").hideHelp(),
			)
			.addOption(
				// TODO: Refactor teams to resume session without team name
				new Option(
					"--team-name <name>",
					"覆盖运行时团队状态名称",
				).hideHelp(),
			)
	);
}

export function createProgram(): Command {
	const program = new Command("cline")
		.description("Cline CLI - 终端中的 AI 编程助手")
		.version(version, "-V, --version", "输出版本号")
		.exitOverride() // don't call process.exit
		.configureOutput({
			writeOut: () => {}, // suppress by default; main.ts re-enables for routing
			writeErr: () => {},
		})
		.allowExcessArguments()
		.enablePositionalOptions()
		.argument(
			"[prompt]",
			"你的提示。默认以执行模式启动并启用自动批准。",
		);

	addRootOptions(program);

	return program;
}

export function commanderToParsedArgs(program: Command): ParsedArgs {
	const opts = program.opts();

	const result: ParsedArgs = {
		verbose: !!opts.verbose,
		interactive: !!opts.tui,
		outputMode: opts.json ? "json" : "text",
		mode: opts.plan ? "plan" : opts.yolo ? "yolo" : opts.zen ? "zen" : "act",
		modeExplicitlySet: !!(opts.plan || opts.act || opts.yolo || opts.zen),
		sandbox: !!opts.dataDir,
		acpMode: !!opts.acp,
		thinking: false,
		reasoningEffort: undefined,
		defaultToolAutoApprove: true,
		id: opts.id,
	};

	// Approval: last-wins semantics
	if (opts.autoApprove !== undefined) {
		const raw = String(opts.autoApprove).trim().toLowerCase();
		if (raw === "true") {
			result.defaultToolAutoApprove = true;
			result.autoApproveOverride = true;
		} else if (raw === "false") {
			result.defaultToolAutoApprove = false;
			result.autoApproveOverride = false;
		} else if (raw) {
			result.invalidAutoApprove = raw;
		}
	}
	if (opts.yolo) {
		result.defaultToolAutoApprove = true;
		result.autoApproveOverride = true;
	}

	// Timeout validation
	if (opts.timeout !== undefined) {
		const raw = opts.timeout.trim();
		const parsed = Number.parseInt(raw, 10);
		if (raw && Number.isInteger(parsed) && parsed >= 1) {
			result.timeoutSeconds = parsed;
		} else if (raw) {
			result.invalidTimeoutSeconds = raw;
		}
	}

	if (opts.thinking !== undefined) {
		const effort = String(opts.thinking).trim().toLowerCase();
		if (
			effort === "none" ||
			effort === "low" ||
			effort === "medium" ||
			effort === "high" ||
			effort === "xhigh"
		) {
			result.thinkingExplicitlySet = true;
			if (effort === "none") {
				result.thinking = false;
				result.reasoningEffort = undefined;
			} else {
				result.thinking = true;
				result.reasoningEffort = effort;
			}
		} else if (effort) {
			result.invalidThinkingLevel = effort;
		}
	}

	if (opts.compaction !== undefined) {
		const mode = String(opts.compaction).trim().toLowerCase();
		const compactionMode = parseCliCompactionMode(mode);
		if (compactionMode) {
			result.compactionMode = compactionMode;
		} else if (mode) {
			result.invalidCompactionMode = mode;
		}
	}

	// Retries (max consecutive mistakes) validation
	if (opts.retries !== undefined) {
		const raw = opts.retries.trim();
		const parsed = Number.parseInt(raw, 10);
		if (raw && Number.isInteger(parsed) && parsed >= 1) {
			result.retries = parsed;
		} else if (raw) {
			result.invalidRetries = raw;
		}
	}

	// Simple string/number options
	if (opts.dataDir !== undefined) result.dataDir = opts.dataDir;
	if (opts.config !== undefined) result.configDir = opts.config;
	if (opts.hooksDir !== undefined) result.hooksDir = opts.hooksDir;
	if (opts.worktree !== undefined) result.worktree = !!opts.worktree;
	if (opts.cwd !== undefined) result.cwd = opts.cwd;
	if (opts.teamName !== undefined) result.teamName = opts.teamName;
	if (opts.system !== undefined) result.systemPrompt = opts.system;
	if (opts.model !== undefined) result.model = opts.model;
	if (opts.provider !== undefined) result.provider = opts.provider;
	if (opts.key !== undefined) result.key = opts.key;
	else if (opts.apiKey !== undefined) result.key = opts.apiKey;
	if (opts.id !== undefined) result.id = opts.id;

	// Positional args → prompt
	const positional = program.args;
	if (positional.length > 0) {
		result.prompt = positional.join(" ");
	}

	return result;
}
