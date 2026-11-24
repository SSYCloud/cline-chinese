import { afterEach, beforeEach, describe, it } from "bun:test"
import "should"
import fs from "fs/promises"
import path from "path"
import sinon from "sinon"
import { HookFactory } from "../hook-factory"
import { createHookTestEnv, HookTestEnv, loadFixture, stubHookDirs, writeHookScriptForPlatform } from "./test-utils"

describe("TaskCancel Hook", () => {
	let tempDir: string
	let sandbox: sinon.SinonSandbox
	let getEnv: () => { tempDir: string }
	let hookTestEnv: HookTestEnv

	const writeHookScript = async (hookPath: string, nodeScript: string): Promise<void> => {
		await writeHookScriptForPlatform(hookPath, nodeScript)
	}

	beforeEach(async () => {
		hookTestEnv = await createHookTestEnv()
		tempDir = hookTestEnv.tempDir
		sandbox = hookTestEnv.sandbox

		getEnv = () => ({ tempDir })
	})

	afterEach(async () => {
		await hookTestEnv.cleanup()
	})

	describe("Hook Input Format", () => {
		it("should handle 'abandoned' completion status", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const status = input.taskCancel.taskMetadata.completionStatus;
// Verify we can read the status (for logging purposes)
if (status !== "abandoned") {
  process.exit(1);
}
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "abandoned",
					},
				},
			})

			result.cancel.should.be.false()
			// Note: contextModification is ignored for TaskCancel hooks
		})

		it("should receive all common hook input fields", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
const input = JSON.parse(require('fs').readFileSync(0, 'utf-8'));
const hasAllFields = input.clineVersion && input.hookName === 'TaskCancel' && 
                     input.timestamp && input.taskId && 
                     input.workspaceRoots !== undefined &&
                     input.model && input.model.provider && input.model.slug;
// Exit with error if fields are missing (for test verification)
if (!hasAllFields) {
  process.exit(1);
}
console.log(JSON.stringify({
  cancel: false,
  contextModification: "",
  errorMessage: ""
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
			// Note: contextModification is ignored for TaskCancel hooks
		})
	})

	describe("Fire-and-Forget Behavior", () => {
		it("should return error message when hook returns cancel: true", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
console.log(JSON.stringify({
  cancel: true,
  contextModification: "",
  errorMessage: "Hook tried to block cancellation"
}))`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			// Hook result includes cancel: true and errorMessage
			// In abortTask(), the errorMessage will be surfaced to the user via this.say("error", ...)
			// but cancellation will still proceed (fire-and-forget behavior)
			result.cancel.should.be.true()
			result.errorMessage?.should.equal("Hook tried to block cancellation")
		})
	})

	describe("Error Handling", () => {
		it("should surface hook errors to the user", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
console.error("Hook execution error");
process.exit(1);`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			// TaskCancel hook errors should throw (they will be caught and surfaced in abortTask)
			try {
				await runner.run({
					taskId: "test-task-id",
					taskCancel: {
						taskMetadata: {
							taskId: "test-task-id",
							ulid: "test-ulid",
							completionStatus: "cancelled",
						},
					},
				})
				throw new Error("Should have thrown")
			} catch (error: any) {
				error.message.should.match(/TaskCancel.*exited with code 1/)
			}
		})

		it("should handle malformed JSON output from hook", async () => {
			const hookPath = path.join(tempDir, ".clinerules", "hooks", "TaskCancel")
			const hookScript = `#!/usr/bin/env node
console.log("not valid json")`

			await writeHookScript(hookPath, hookScript)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			// When hook exits 0 but has malformed JSON, it returns success without context
			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			// Hook succeeded (exit 0) but couldn't parse JSON, so returns success without context
			result.cancel.should.be.false()
			;(result.contextModification === undefined || result.contextModification === "").should.be.true()
		})
	})

	describe("Global and Workspace Hooks", () => {
		let globalHooksDir: string
		let workspaceHooksDir: string

		beforeEach(async () => {
			// Create global hooks directory
			globalHooksDir = path.join(tempDir, "global-hooks")
			await fs.mkdir(globalHooksDir, { recursive: true })
			workspaceHooksDir = path.join(tempDir, ".clinerules", "hooks")

			// Use deterministic hook directories to avoid test flakiness.
			stubHookDirs(sandbox, [globalHooksDir, workspaceHooksDir])
		})
	})

	describe("No Hook Behavior", () => {
		it("should succeed when no hook exists", async () => {
			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
		})
	})

	describe("Fixture-Based Tests", () => {
		it("should handle cancel: true with no error message", async () => {
			await loadFixture("hooks/taskcancel/false-no-error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.true()
			result.errorMessage?.should.equal("")
			// In abortTask(), no error is surfaced since errorMessage is empty
			// Cancellation still proceeds (fire-and-forget)
		})

		it("should handle cancel: true with error message", async () => {
			await loadFixture("hooks/taskcancel/false-with-error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.true()
			result.errorMessage?.should.equal("some error happened")
			// In abortTask(), the errorMessage WILL be surfaced to user via this.say("error", ...)
			// Cancellation still proceeds (fire-and-forget)
		})

		it("should handle cancel: false with error message", async () => {
			await loadFixture("hooks/taskcancel/true-with-error", getEnv().tempDir)

			const factory = new HookFactory()
			const runner = await factory.create("TaskCancel")

			const result = await runner.run({
				taskId: "test-task-id",
				taskCancel: {
					taskMetadata: {
						taskId: "test-task-id",
						ulid: "test-ulid",
						completionStatus: "cancelled",
					},
				},
			})

			result.cancel.should.be.false()
			result.errorMessage?.should.equal("some error happened")
			// In abortTask(), the errorMessage WILL be surfaced to user via this.say("error", ...)
			// This is the scenario that was fixed - error messages are now displayed regardless of shouldContinue value
			// Cancellation still proceeds (fire-and-forget)
		})
	})
})
