import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Command } from "commander";
import { ensureSchedulerHub } from "./client";
import {
	addAutonomousOptions,
	addDeliveryOptions,
	addSharedOptions,
	emitJsonOrText,
	formatResolvedAddressLabel,
	hasMetadataPatchOpts,
	isJsonPath,
	mergeScheduleMetadata,
	parseJsonObjectFlag,
	parseList,
	parseMode,
	resolveAddress,
	toPositiveInt,
} from "./common";
import type { CommandIo, ScheduleActionWrapper } from "./types";

function resolveImportedModelSelection(parsed: Record<string, unknown>): {
	provider: string;
	model: string;
} {
	const modelSelection =
		parsed.modelSelection &&
		typeof parsed.modelSelection === "object" &&
		!Array.isArray(parsed.modelSelection)
			? (parsed.modelSelection as Record<string, unknown>)
			: undefined;
	const provider = String(
		modelSelection?.providerId ??
			parsed.providerId ??
			parsed.provider ??
			"cline",
	).trim();
	const model = String(
		modelSelection?.modelId ??
			parsed.modelId ??
			parsed.model ??
			"openai/gpt-5.3-codex",
	).trim();
	return { provider, model };
}

export function registerScheduleExportCommand(
	schedule: Command,
	io: CommandIo,
	fail: () => void,
	action: ScheduleActionWrapper,
): void {
	const exportCmd = schedule
		.command("export")
		.description("导出日程")
		.argument("<schedule-id>", "日程 ID")
		.option("--to <path>", "输出文件路径");
	addSharedOptions(exportCmd);
	exportCmd.action(
		action(async (scheduleId: string) => {
			const opts = exportCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const result = await client.getSchedule(scheduleId);
				if (!result) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				const toPath =
					typeof opts.to === "string" && opts.to.length > 0
						? opts.to
						: undefined;
				if (toPath) {
					try {
						const resolvedPath = isAbsolute(toPath)
							? toPath
							: resolve(process.cwd(), toPath);
						await mkdir(dirname(resolvedPath), { recursive: true });
						const useJson = !!opts.json || isJsonPath(resolvedPath);
						let serialized: string;
						if (useJson) {
							serialized = JSON.stringify(result, null, 2);
						} else {
							const yaml = await import("yaml");
							serialized = yaml.stringify(result);
						}
						await writeFile(resolvedPath, serialized, "utf8");
						io.writeln(`Exported schedule ${scheduleId} to ${resolvedPath}`);
					} catch (error) {
						io.writeErr(error instanceof Error ? error.message : String(error));
						fail();
					}
					return;
				}
				if (opts.json) {
					io.writeln(JSON.stringify(result, null, 2));
					return;
				}
				const yaml = await import("yaml");
				io.writeln(yaml.stringify(result));
			} finally {
				client.close();
			}
		}),
	);
}

export function registerScheduleImportCommand(
	schedule: Command,
	io: CommandIo,
	fail: () => void,
	action: ScheduleActionWrapper,
): void {
	const importCmd = schedule
		.command("import")
		.description("从文件导入日程")
		.argument("<path>", "源文件路径");
	addSharedOptions(importCmd);
	importCmd.action(
		action(async (sourcePath: string) => {
			const opts = importCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`未能确保中心服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const sourceRaw = await readFile(sourcePath, "utf8");
				let parsed: Record<string, unknown>;
				if (isJsonPath(sourcePath)) {
					parsed = JSON.parse(sourceRaw) as Record<string, unknown>;
				} else {
					const yaml = await import("yaml");
					parsed = yaml.parse(sourceRaw) as Record<string, unknown>;
				}
				const workspaceRoot = String(
					parsed.workspaceRoot ?? parsed.workspace_root ?? "",
				).trim();
				if (!workspaceRoot) {
					io.writeErr(
						"日程导入需要在源文件中指定 workspaceRoot/workspace_root",
					);
					fail();
					return;
				}
				const { provider, model } = resolveImportedModelSelection(parsed);
				const created = await client.createSchedule({
					name: String(parsed.name ?? "").trim(),
					cronPattern: String(parsed.cronPattern ?? parsed.cron ?? "").trim(),
					prompt: String(parsed.prompt ?? "").trim(),
					provider,
					model,
					mode: parsed.mode === "plan" ? "plan" : "act",
					workspaceRoot,
					cwd: String(parsed.cwd ?? "").trim() || undefined,
					systemPrompt:
						String(parsed.systemPrompt ?? parsed.system_prompt ?? "").trim() ||
						undefined,
					timeoutSeconds:
						typeof parsed.timeoutSeconds === "number"
							? parsed.timeoutSeconds
							: typeof parsed.timeout_seconds === "number"
								? parsed.timeout_seconds
								: undefined,
					maxParallel:
						typeof parsed.maxParallel === "number"
							? parsed.maxParallel
							: typeof parsed.max_parallel === "number"
								? parsed.max_parallel
								: 1,
					enabled: parsed.enabled !== false,
					createdBy:
						String(parsed.createdBy ?? parsed.created_by ?? "").trim() ||
						undefined,
					tags: Array.isArray(parsed.tags)
						? parsed.tags
								.map((item) => (typeof item === "string" ? item.trim() : ""))
								.filter((item) => item.length > 0)
						: undefined,
					metadata: mergeScheduleMetadata(
						parsed.metadata && typeof parsed.metadata === "object"
							? (parsed.metadata as Record<string, unknown>)
							: undefined,
						opts,
					),
				});
				if (!created) {
					io.writeErr("导入日程失败");
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, created);
			} finally {
				client.close();
			}
		}),
	);
}

export function registerScheduleUpdateCommand(
	schedule: Command,
	io: CommandIo,
	fail: () => void,
	action: ScheduleActionWrapper,
): void {
	const updateCmd = schedule
		.command("update")
		.description("更新日程")
		.argument("<schedule-id>", "日程 ID")
		.option("--clear-timeout", "删除超时")
		.option("--cron <pattern>", "新的 cron pattern")
		.option("--cwd <path>", "新的工作目录")
		.option("--disabled", "禁用日程")
		.option("--enabled", "启用日程")
		.option("--max-parallel <n>", "新的最大并行执行数")
		.option("--metadata-json <json>", "新的元数据作为 JSON 对象")
		.option("--mode <act|plan>", "新的执行模式")
		.option("--model <model>", "新的模型")
		.option("--name <name>", "新的名称")
		.option("--pause", "暂停日程")
		.option("--prompt <text>", "新的提示")
		.option("--provider <id>", "新的提供商 ID")
		.option("--resume", "恢复日程")
		.option("--system-prompt <text>", "新的系统提示")
		.option("--tags <list>", "新的逗号分隔标签")
		.option("--timeout <n>", "新的超时时间（秒）")
		.option("--workspace <path>", "新的工作区根目录");
	addDeliveryOptions(updateCmd);
	addAutonomousOptions(updateCmd);
	addSharedOptions(updateCmd);
	updateCmd.action(
		action(async (scheduleId: string) => {
			const opts = updateCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(
					`未能确保中心服务器${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				if (opts.pause) {
					const result = await client.pauseSchedule(scheduleId);
					emitJsonOrText(!!opts.json, io, result ?? { updated: false });
					if (!result) fail();
					return;
				}
				if (opts.resume) {
					const result = await client.resumeSchedule(scheduleId);
					emitJsonOrText(!!opts.json, io, result ?? { updated: false });
					if (!result) fail();
					return;
				}
				let metadata: Record<string, unknown> | undefined;
				if (hasMetadataPatchOpts(opts)) {
					const current = (await client.getSchedule(scheduleId)) as
						| { metadata?: Record<string, unknown> }
						| undefined;
					if (!current) {
						io.writeErr(`schedule not found: ${scheduleId}`);
						fail();
						return;
					}
					const metadataBase = {
						...(current.metadata ?? {}),
						...(parseJsonObjectFlag(opts.metadataJson) ?? {}),
					};
					metadata = mergeScheduleMetadata(metadataBase, opts);
				}
				const updated = await client.updateSchedule(scheduleId, {
					name: opts.name,
					cronPattern: opts.cron,
					prompt: opts.prompt,
					provider: opts.provider,
					model: opts.model,
					mode: parseMode(opts.mode),
					workspaceRoot: opts.workspace,
					cwd: opts.cwd,
					systemPrompt: opts.systemPrompt,
					timeoutSeconds: opts.timeout
						? toPositiveInt(opts.timeout, 1)
						: opts.clearTimeout
							? null
							: undefined,
					maxParallel: opts.maxParallel
						? toPositiveInt(opts.maxParallel, 1)
						: undefined,
					enabled: opts.enabled ? true : opts.disabled ? false : undefined,
					tags: opts.tags ? parseList(opts.tags) : undefined,
					metadata,
				});
				if (!updated) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, updated);
			} finally {
				client.close();
			}
		}),
	);
}
