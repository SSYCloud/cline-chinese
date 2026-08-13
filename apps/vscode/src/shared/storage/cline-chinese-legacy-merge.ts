/**
 * One-time-per-version merge of the legacy `~/.cline-chinese/data` directory
 * (left behind by older "cline-chinese"-branded installs) into the current
 * file-backed stores under `~/.cline/data`.
 *
 * ## Merge semantics
 *
 * - For each of globalState.json / secrets.json / workspaceState.json, keys
 *   present only in the legacy file are always merged in. Keys present in
 *   both are resolved by comparing the two files' mtimes as a whole: the
 *   value from whichever file was modified more recently wins.
 * - The legacy `.cline-chinese` directory is never modified or deleted —
 *   this merge only ever reads from it.
 * - Two independent sentinels (mirroring vscode-to-file-migration.ts) gate
 *   idempotency: one in `globalState` for globalState+secrets, one in
 *   `workspaceState` so each newly opened workspace still gets its own
 *   workspaceState.json merged in exactly once.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Logger } from "../services/Logger"
import type { StorageContext } from "./storage-context"

/** Bump when the merge logic changes in a way that should re-run for existing installs. */
const CURRENT_MERGE_VERSION = 1

/** Sentinel key written to both globalState and workspaceState to track the merge independently. */
const MERGE_VERSION_KEY = "__clineChineseMergeVersion"

export interface ClineChineseMergeOptions {
	/** Override the legacy `.cline-chinese` root directory. Used by tests. */
	legacyClineDir?: string
}

function readJsonRecord(filePath: string): Record<string, any> | undefined {
	try {
		if (!fs.existsSync(filePath)) {
			return undefined
		}
		const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"))
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined
	} catch (error) {
		Logger.warn(`[ClineChineseMerge] Failed to read ${filePath}:`, error)
		return undefined
	}
}

/**
 * Merge `legacyPath` into `currentPath`, resolving key conflicts by whichever
 * file was modified more recently. Returns only the keys that need to be
 * written to the current store (i.e. new or legacy-wins keys), or undefined
 * if there is nothing to merge.
 */
function mergeJsonFileByMtime(legacyPath: string, currentPath: string): Record<string, any> | undefined {
	const legacyData = readJsonRecord(legacyPath)
	if (!legacyData) {
		return undefined
	}

	const currentData = readJsonRecord(currentPath)
	if (!currentData) {
		return Object.keys(legacyData).length > 0 ? legacyData : undefined
	}

	let legacyIsNewer = false
	try {
		const legacyMtime = fs.statSync(legacyPath).mtimeMs
		const currentMtime = fs.statSync(currentPath).mtimeMs
		legacyIsNewer = legacyMtime > currentMtime
	} catch (error) {
		Logger.warn(`[ClineChineseMerge] Failed to stat ${legacyPath} or ${currentPath}:`, error)
		return undefined
	}

	const diff: Record<string, any> = {}
	for (const [key, value] of Object.entries(legacyData)) {
		if (!(key in currentData)) {
			diff[key] = value
		} else if (legacyIsNewer) {
			diff[key] = value
		}
	}

	return Object.keys(diff).length > 0 ? diff : undefined
}

function legacyDataDir(opts?: ClineChineseMergeOptions): string {
	const legacyClineDir = opts?.legacyClineDir ?? path.join(os.homedir(), ".cline-chinese")
	return path.join(legacyClineDir, "data")
}

/**
 * Merge legacy `.cline-chinese` data into the given StorageContext.
 *
 * Safe to call on every startup — checks sentinels and returns immediately
 * once the merge has already run at the current version for the relevant store.
 */
export function mergeLegacyClineChineseStorage(storage: StorageContext, opts?: ClineChineseMergeOptions): void {
	const dataDir = legacyDataDir(opts)

	const globalVersion = storage.globalState.get<number>(MERGE_VERSION_KEY)
	if (globalVersion === undefined || globalVersion < CURRENT_MERGE_VERSION) {
		try {
			const globalStateDiff = mergeJsonFileByMtime(
				path.join(dataDir, "globalState.json"),
				path.join(storage.dataDir, "globalState.json"),
			)
			const secretsDiff = mergeJsonFileByMtime(
				path.join(dataDir, "secrets.json"),
				path.join(storage.dataDir, "secrets.json"),
			)

			if (globalStateDiff) {
				storage.globalState.setBatch(globalStateDiff)
			}
			if (secretsDiff) {
				storage.secrets.setBatch(secretsDiff)
			}
			storage.globalState.update(MERGE_VERSION_KEY, CURRENT_MERGE_VERSION)
		} catch (error) {
			Logger.error("[ClineChineseMerge] Failed to merge globalState/secrets from .cline-chinese:", error)
		}
	}

	const workspaceVersion = storage.workspaceState.get<number>(MERGE_VERSION_KEY)
	if (workspaceVersion === undefined || workspaceVersion < CURRENT_MERGE_VERSION) {
		try {
			const workspaceHash = path.basename(storage.workspaceStoragePath)
			const legacyWorkspaceStatePath = path.join(dataDir, "workspaces", workspaceHash, "workspaceState.json")
			const currentWorkspaceStatePath = path.join(storage.workspaceStoragePath, "workspaceState.json")

			const workspaceStateDiff = mergeJsonFileByMtime(legacyWorkspaceStatePath, currentWorkspaceStatePath)
			if (workspaceStateDiff) {
				storage.workspaceState.setBatch(workspaceStateDiff)
			}
			storage.workspaceState.set(MERGE_VERSION_KEY, CURRENT_MERGE_VERSION)
		} catch (error) {
			Logger.error("[ClineChineseMerge] Failed to merge workspaceState from .cline-chinese:", error)
		}
	}
}
