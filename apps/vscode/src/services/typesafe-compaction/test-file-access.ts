import { execFile } from "node:child_process"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import type { TestFileAccess } from "./library"

const run = promisify(execFile)

export function createTestFileAccess(root: string): TestFileAccess {
	return {
		async list() {
			try {
				const { stdout } = await run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
					cwd: root,
					maxBuffer: 32 * 1024 * 1024,
				})
				return stdout.split("\n").filter(Boolean)
			} catch (error) {
				throw new Error(`git ls-files failed: ${error instanceof Error ? error.message : String(error)}`)
			}
		},
		read: (file) => readFile(path.resolve(root, file), "utf8"),
		write: (file, text) => writeFile(path.resolve(root, file), text, "utf8"),
	}
}
