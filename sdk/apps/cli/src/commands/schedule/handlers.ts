import type { Command } from "commander";
import { ensureSchedulerHub } from "./client";
import {
	addAutonomousOptions,
	addDeliveryOptions,
	addSharedOptions,
	emitJsonOrText,
	formatResolvedAddressLabel,
	mergeScheduleMetadata,
	parseJsonObjectFlag,
	parseList,
	resolveAddress,
	toPositiveInt,
} from "./common";
import {
	registerScheduleExportCommand,
	registerScheduleImportCommand,
	registerScheduleUpdateCommand,
} from "./import-export";
import type { CommandIo, ScheduleActionWrapper } from "./types";

export function registerScheduleCommands(
	schedule: Command,
	io: CommandIo,
	fail: () => void,
	action: ScheduleActionWrapper,
): void {
	const activeCmd = schedule
		.command("active")
		.description("Show currently active executions");
	addSharedOptions(activeCmd);
	activeCmd.action(
		action(async () => {
			const opts = activeCmd.opts();
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
				const active = await client.getActiveScheduledExecutions();
				emitJsonOrText(!!opts.json, io, active);
			} finally {
				client.close();
			}
		}),
	);

	const createCmd = schedule
		.command("create")
		.description("创建新日程")
		.argument("<name>", "日程名")
		.requiredOption("--cron <pattern>", "Cron 模式")
		.requiredOption("--prompt <text>", "任务提示词")
		.requiredOption("--workspace <path>", "工作区根目录")
		.option("--created-by <name>", "创作者名")
		.option("--cwd <path>", "工作目录")
		.option("--disabled", "以禁用状态创建")
		.option("--max-parallel <n>", "最大并行执行数", "1")
		.option("--metadata-json <json>", "作为 JSON 对象的元数据")
		.option("--mode <act|plan>", "执行模式")
		.option("--model <model>", "要使用的模型", "openai/gpt-5.3-codex")
		.option("--provider <id>", "供应商 ID", "cline")
		.option("--system-prompt <text>", "系统提示词覆盖")
		.option("--tags <list>", "逗号分隔的标签")
		.option("--timeout <seconds>", "超时时间（秒）");
	addDeliveryOptions(createCmd);
	addAutonomousOptions(createCmd);
	addSharedOptions(createCmd);
	createCmd.action(
		action(async (name: string) => {
			const opts = createCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, opts.workspace, io);
			if (!ensured.ok) {
				io.writeErr(
					`failed to ensure hub server${formatResolvedAddressLabel(address)}`,
				);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const metadata = mergeScheduleMetadata(
					parseJsonObjectFlag(opts.metadataJson),
					opts,
				);
				const created = await client.createSchedule({
					name,
					cronPattern: opts.cron,
					prompt: opts.prompt,
					provider: opts.provider,
					model: opts.model,
					mode: opts.mode === "plan" ? "plan" : "act",
					workspaceRoot: opts.workspace,
					cwd: opts.cwd,
					systemPrompt: opts.systemPrompt,
					timeoutSeconds: opts.timeout
						? toPositiveInt(opts.timeout, 1)
						: undefined,
					maxParallel: toPositiveInt(opts.maxParallel, 1),
					enabled: !opts.disabled,
					createdBy: opts.createdBy,
					tags: parseList(opts.tags),
					metadata,
				});
				if (!created) {
					io.writeErr("创建日程失败");
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, created);
			} finally {
				client.close();
			}
		}),
	);

	const deleteCmd = schedule
		.command("delete")
		.description("Delete a schedule")
		.argument("<schedule-id>", "Schedule ID");
	addSharedOptions(deleteCmd);
	deleteCmd.action(
		action(async (scheduleId: string) => {
			const opts = deleteCmd.opts();
			const address = resolveAddress(opts.address);
			const ensured = await ensureSchedulerHub(address, process.cwd(), io);
			if (!ensured.ok) {
				io.writeErr(`未能确保中心服务器${formatResolvedAddressLabel(address)}`);
				fail();
				return;
			}
			const client = ensured.client;
			try {
				const deleted = await client.deleteSchedule(scheduleId);
				emitJsonOrText(!!opts.json, io, { deleted });
				if (!deleted) fail();
			} finally {
				client.close();
			}
		}),
	);

	const getCmd = schedule
		.command("get")
		.description("根据 ID 获取日程")
		.argument("<schedule-id>", "日程 ID");
	addSharedOptions(getCmd);
	getCmd.action(
		action(async (scheduleId: string) => {
			const opts = getCmd.opts();
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
				emitJsonOrText(!!opts.json, io, result);
			} finally {
				client.close();
			}
		}),
	);

	const historyCmd = schedule
		.command("history")
		.description("显示日程的执行历史")
		.argument("<schedule-id>", "日程 ID")
		.option("--limit <n>", "结果的最大数量", "20")
		.option("--status <status>", "按执行状态过滤");
	addSharedOptions(historyCmd);
	historyCmd.action(
		action(async (scheduleId: string) => {
			const opts = historyCmd.opts();
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
				const executions = await client.listScheduleExecutions({
					scheduleId,
					status: opts.status,
					limit: toPositiveInt(opts.limit, 20),
				});
				emitJsonOrText(!!opts.json, io, executions);
			} finally {
				client.close();
			}
		}),
	);

	const listCmd = schedule
		.command("list")
		.description("列出日程")
		.option("--disabled", "只显示已禁用的日程")
		.option("--enabled", "只显示已启用的日程")
		.option("--limit <n>", "结果的最大数量", "100")
		.option("--tags <list>", "按逗号分隔的标签过滤");
	addSharedOptions(listCmd);
	listCmd.action(
		action(async () => {
			const opts = listCmd.opts();
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
				const enabled = opts.enabled ? true : opts.disabled ? false : undefined;
				const schedules = await client.listSchedules({
					limit: toPositiveInt(opts.limit, 100),
					enabled,
					tags: parseList(opts.tags),
				});
				if (!opts.json && Array.isArray(schedules) && schedules.length === 0) {
					io.writeln("No schedules found.");
					return;
				}
				emitJsonOrText(!!opts.json, io, schedules);
			} finally {
				client.close();
			}
		}),
	);

	const pauseCmd = schedule
		.command("pause")
		.description("暂停日程")
		.argument("<schedule-id>", "日程 ID");
	addSharedOptions(pauseCmd);
	pauseCmd.action(
		action(async (scheduleId: string) => {
			const opts = pauseCmd.opts();
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
				const result = await client.pauseSchedule(scheduleId);
				if (!result) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, result);
			} finally {
				client.close();
			}
		}),
	);

	const resumeCmd = schedule
		.command("resume")
		.description("恢复日程")
		.argument("<schedule-id>", "日程 ID");
	addSharedOptions(resumeCmd);
	resumeCmd.action(
		action(async (scheduleId: string) => {
			const opts = resumeCmd.opts();
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
				const result = await client.resumeSchedule(scheduleId);
				if (!result) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, result);
			} finally {
				client.close();
			}
		}),
	);

	const statsCmd = schedule
		.command("stats")
		.description("显示日程的统计信息")
		.argument("<schedule-id>", "日程 ID");
	addSharedOptions(statsCmd);
	statsCmd.action(
		action(async (scheduleId: string) => {
			const opts = statsCmd.opts();
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
				const stats = await client.getScheduleStats(scheduleId);
				emitJsonOrText(!!opts.json, io, stats);
			} finally {
				client.close();
			}
		}),
	);

	const triggerCmd = schedule
		.command("trigger")
		.description("立即触发日程")
		.argument("<schedule-id>", "日程 ID");
	addSharedOptions(triggerCmd);
	triggerCmd.action(
		action(async (scheduleId: string) => {
			const opts = triggerCmd.opts();
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
				const execution = await client.triggerScheduleNow(scheduleId);
				if (!execution) {
					io.writeErr(`schedule not found: ${scheduleId}`);
					fail();
					return;
				}
				emitJsonOrText(!!opts.json, io, execution);
			} finally {
				client.close();
			}
		}),
	);

	const upcomingCmd = schedule
		.command("upcoming")
		.description("显示即将进行的计划运行")
		.option("--limit <n>", "结果的最大数量", "20");
	addSharedOptions(upcomingCmd);
	upcomingCmd.action(
		action(async () => {
			const opts = upcomingCmd.opts();
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
				const runs = await client.getUpcomingScheduledRuns(
					toPositiveInt(opts.limit, 20),
				);
				emitJsonOrText(!!opts.json, io, runs);
			} finally {
				client.close();
			}
		}),
	);

	registerScheduleExportCommand(schedule, io, fail, action);
	registerScheduleImportCommand(schedule, io, fail, action);
	registerScheduleUpdateCommand(schedule, io, fail, action);
}
