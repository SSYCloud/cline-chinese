import { describe, it } from "bun:test"
import "should"
import { formatResponse } from "../responses"

describe("formatResponse.replaceInFileMissingDiffError", () => {
	it("should NOT include the generic toolUseInstructionsReminder", () => {
		const result = formatResponse.replaceInFileMissingDiffError("src/index.ts")
		result.should.not.containEql("Reminder: Instructions for Tool Use")
	})

	it("should work with different file paths", () => {
		const result = formatResponse.replaceInFileMissingDiffError("components/App.tsx")
		result.should.containEql("components/App.tsx")
	})
})

describe("formatResponse.executeCommandMissingCommandError", () => {
	it("should mention that the command parameter was empty", () => {
		const result = formatResponse.executeCommandMissingCommandError()
		result.should.containEql("'command' parameter was empty")
	})

	it("should include a concrete XML example", () => {
		const result = formatResponse.executeCommandMissingCommandError()
		result.should.containEql("<execute_command>")
		result.should.containEql("<command>")
		result.should.containEql("</command>")
		result.should.containEql("</execute_command>")
	})

	it("should NOT include the generic toolUseInstructionsReminder", () => {
		const result = formatResponse.executeCommandMissingCommandError()
		result.should.not.containEql("Reminder: Instructions for Tool Use")
	})
})
