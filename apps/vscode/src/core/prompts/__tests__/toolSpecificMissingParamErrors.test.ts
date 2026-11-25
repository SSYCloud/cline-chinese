import { describe, it } from "bun:test"
import "should"
import { formatResponse } from "../responses"

describe("formatResponse.replaceInFileMissingDiffError", () => {
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
})
