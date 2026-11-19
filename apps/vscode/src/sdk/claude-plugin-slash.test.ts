import { describe, expect, it } from "bun:test"
import { expandClaudePluginSlashCommands } from "./slash-command-expansion"

const config = {
	name: "tokeneconomizer:config",
	template: "run /cache/tokeneconomizer/scripts/te --cwd $(pwd) config $ARGUMENTS",
}

describe("expandClaudePluginSlashCommands", () => {
	it("expands /plugin:command with the rest of the line as $ARGUMENTS", () => {
		expect(expandClaudePluginSlashCommands("/tokeneconomizer:config set KEY=1", [config])).toBe(
			"run /cache/tokeneconomizer/scripts/te --cwd $(pwd) config set KEY=1",
		)
	})

	it("expands a bare command to an empty $ARGUMENTS, showing every setting", () => {
		expect(expandClaudePluginSlashCommands("/tokeneconomizer:config", [config])).toBe(
			"run /cache/tokeneconomizer/scripts/te --cwd $(pwd) config ",
		)
	})

	it("keeps text on later lines exactly as typed", () => {
		expect(expandClaudePluginSlashCommands("/tokeneconomizer:config show\nthanks", [config])).toBe(
			"run /cache/tokeneconomizer/scripts/te --cwd $(pwd) config show\nthanks",
		)
	})

	it("leaves text untouched when no Claude command matches", () => {
		expect(expandClaudePluginSlashCommands("/unknown:thing", [config])).toBe("/unknown:thing")
	})
})
