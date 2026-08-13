import { afterEach, beforeEach, describe, it } from "bun:test"
import fs from "fs"
import os from "os"
import path from "path"
import "should"
import { createStorageContext, type StorageContext } from "@shared/storage/storage-context"

describe("cline-chinese-legacy-merge", () => {
	let clineDir: string
	let legacyClineDir: string

	beforeEach(() => {
		const base = path.join(os.tmpdir(), `cline-chinese-merge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		clineDir = path.join(base, "cline")
		legacyClineDir = path.join(base, "cline-chinese")
		fs.mkdirSync(clineDir, { recursive: true })
		fs.mkdirSync(legacyClineDir, { recursive: true })
	})

	afterEach(() => {
		try {
			fs.rmSync(path.dirname(clineDir), { recursive: true, force: true })
		} catch {
			// Ignore cleanup errors
		}
	})

	function writeLegacyGlobalState(data: Record<string, any>, mtime?: Date) {
		const dir = path.join(legacyClineDir, "data")
		fs.mkdirSync(dir, { recursive: true })
		const filePath = path.join(dir, "globalState.json")
		fs.writeFileSync(filePath, JSON.stringify(data))
		if (mtime) {
			fs.utimesSync(filePath, mtime, mtime)
		}
	}

	function createContext(): StorageContext {
		return createStorageContext({
			clineDir,
			workspacePath: clineDir,
			legacyClineChineseDir: legacyClineDir,
		})
	}

	it("does nothing when legacy directory has no data", () => {
		const ctx = createContext()
		ctx.globalState.keys().length.should.equal(1) // just the sentinel
		;(ctx.globalState.get("__clineChineseMergeVersion") as number).should.equal(1)
	})

	it("merges legacy-only keys into an empty current store", () => {
		writeLegacyGlobalState({ preferredLanguage: "Simplified Chinese - 简体中文" })

		const ctx = createContext()

		ctx.globalState.get("preferredLanguage")!.should.equal("Simplified Chinese - 简体中文")
	})

	it("legacy value wins when the legacy file is newer", () => {
		// Current store already has a value for "mode" written first (older mtime).
		const ctx1 = createContext()
		ctx1.globalState.update("mode", "act")

		// Legacy file written afterwards, so it's newer.
		writeLegacyGlobalState({ mode: "plan" }, new Date(Date.now() + 60_000))

		// Force sentinel to look stale by resetting the version and re-run under a fresh context.
		ctx1.globalState.update("__clineChineseMergeVersion", undefined as any)
		const ctx2 = createContext()

		ctx2.globalState.get("mode")!.should.equal("plan")
	})

	it("current value wins when the current file is newer", () => {
		writeLegacyGlobalState({ mode: "plan" }, new Date(Date.now() - 60_000))

		const ctx = createContext()
		ctx.globalState.get("mode")!.should.equal("plan")

		// Overwrite current with a newer value/mtime, then force the sentinel stale and re-run.
		ctx.globalState.update("mode", "act")
		ctx.globalState.update("__clineChineseMergeVersion", undefined as any)
		const ctx2 = createContext()

		ctx2.globalState.get("mode")!.should.equal("act")
	})

	it("only merges the workspaceState.json for the current workspace hash", () => {
		const ctx = createContext()
		const currentHash = path.basename(ctx.workspaceStoragePath)

		const otherHashDir = path.join(legacyClineDir, "data", "workspaces", "deadbeef")
		fs.mkdirSync(otherHashDir, { recursive: true })
		fs.writeFileSync(path.join(otherHashDir, "workspaceState.json"), JSON.stringify({ leaked: true }))

		const matchingHashDir = path.join(legacyClineDir, "data", "workspaces", currentHash)
		fs.mkdirSync(matchingHashDir, { recursive: true })
		fs.writeFileSync(
			path.join(matchingHashDir, "workspaceState.json"),
			JSON.stringify({ localClineRulesToggles: { a: true } }),
		)

		ctx.workspaceState.update("__clineChineseMergeVersion", undefined as any)
		const ctx2 = createStorageContext({
			clineDir,
			workspacePath: clineDir,
			legacyClineChineseDir: legacyClineDir,
		})

		ctx2.workspaceState.get("localClineRulesToggles")!.should.deepEqual({ a: true })
		;(ctx2.workspaceState.get("leaked") === undefined).should.be.true()
	})

	it("does not re-merge once the sentinel is current", () => {
		writeLegacyGlobalState({ mode: "plan" })
		const ctx = createContext()
		ctx.globalState.get("mode")!.should.equal("plan")

		// Change legacy value + bump mtime; a second construction should be a no-op since the sentinel is current.
		writeLegacyGlobalState({ mode: "act" }, new Date(Date.now() + 120_000))
		const ctx2 = createContext()

		ctx2.globalState.get("mode")!.should.equal("plan")
	})

	it("does not throw and leaves current data intact when legacy JSON is corrupt", () => {
		const dir = path.join(legacyClineDir, "data")
		fs.mkdirSync(dir, { recursive: true })
		fs.writeFileSync(path.join(dir, "globalState.json"), "{ not valid json")

		const ctx1 = createContext()
		ctx1.globalState.update("mode", "act")

		ctx1.globalState.update("__clineChineseMergeVersion", undefined as any)
		const ctx2 = createContext()

		ctx2.globalState.get("mode")!.should.equal("act")
	})
})
