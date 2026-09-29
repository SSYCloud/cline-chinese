import type { BatchOutputDestination } from "@shared/loomloom"

/** Display only a host-selected destination; never derive a path from cloud artifact metadata. */
export function batchOutputRoot(destination?: BatchOutputDestination): string | undefined {
	if (!destination) return undefined
	if (destination.outputRootDirectory) return destination.outputRootDirectory
	const base = destination.baseDirectory.replace(/[\\/]+$/, "")
	const separator = base.includes("\\") ? "\\" : "/"
	return `${base}${separator}.cline${separator}loomloom-outputs`
}
