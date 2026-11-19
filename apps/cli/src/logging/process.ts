import { createCliLoggerAdapter } from "./adapter";

interface LogSpawnedProcessInput {
	component: string;
	command: string[];
	childPid?: number;
	cwd?: string;
	detached?: boolean;
	metadata?: Record<string, unknown>;
}

// The log message doubles as the marker `doctor` uses to find spawned
// processes, so the pre-localization English line stays recognized for logs
// written by older builds.
export const PROCESS_SPAWNED_LOG_MESSAGE = "进程已生成";

export function isSpawnedProcessLogMessage(message: unknown): boolean {
	return (
		message === PROCESS_SPAWNED_LOG_MESSAGE || message === "Process spawned"
	);
}

export function logSpawnedProcess(input: LogSpawnedProcessInput): void {
	try {
		const logger = createCliLoggerAdapter({
			runtime: "cli",
			component: input.component,
		});
		logger.core.log(PROCESS_SPAWNED_LOG_MESSAGE, {
			command: input.command.join(" "),
			commandArgs: input.command.slice(1),
			executable: input.command[0],
			childPid: input.childPid,
			cwd: input.cwd,
			detached: input.detached,
			...input.metadata,
		});
	} catch {
		// Best-effort logging only.
	}
}
