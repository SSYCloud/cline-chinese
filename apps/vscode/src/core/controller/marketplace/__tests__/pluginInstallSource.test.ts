import { afterEach, describe, it, mock } from "bun:test"
import * as assert from "assert"
import sinon from "sinon"

const installPluginStub = sinon.stub()

const actualCore = await import("@cline/core")

mock.module("@cline/core", () => {
	return {
		...actualCore,
		installPlugin: installPluginStub,
	}
})

function pluginEntry(overrides: Record<string, unknown>) {
	return {
		id: "tokeneconomizer",
		type: "plugin" as const,
		name: "TokenEconomizer",
		tags: [],
		tagObjects: [],
		install: { args: ["tokeneconomizer"], command: "cline plugin install microsoft/tokeneconomizer" },
		...overrides,
	}
}

describe("marketplace plugin install source", () => {
	afterEach(() => {
		installPluginStub.reset()
	})

	it("installs from the entry repo when it is a plain GitHub repository", async () => {
		const { installMarketplaceEntryFromCatalog } = await import("../marketplace-helpers")
		installPluginStub.resolves({ installPath: "/tmp/p", entryPaths: [], mcpSyncFailures: [], mcpOAuthCandidates: [] })

		await installMarketplaceEntryFromCatalog(
			pluginEntry({ sourceUrl: "https://github.com/microsoft/TokenEconomizer" }) as never,
		)

		assert.deepStrictEqual(installPluginStub.firstCall.args[0], {
			source: "https://github.com/microsoft/TokenEconomizer",
		})
	})

	it("keeps the official slug when the repo points into a subdirectory", async () => {
		const { installMarketplaceEntryFromCatalog } = await import("../marketplace-helpers")
		installPluginStub.resolves({ installPath: "/tmp/p", entryPaths: [], mcpSyncFailures: [], mcpOAuthCandidates: [] })

		await installMarketplaceEntryFromCatalog(
			pluginEntry({
				id: "branch-protector-zh",
				install: { args: ["branch-protector"] },
				sourceUrl: "https://github.com/cline/plugins/tree/main/plugins/branch-protector",
			}) as never,
		)

		assert.deepStrictEqual(installPluginStub.firstCall.args[0], { source: "branch-protector" })
	})

	it("uses the official slug when the entry has no repo", async () => {
		const { installMarketplaceEntryFromCatalog } = await import("../marketplace-helpers")
		installPluginStub.resolves({ installPath: "/tmp/p", entryPaths: [], mcpSyncFailures: [], mcpOAuthCandidates: [] })

		await installMarketplaceEntryFromCatalog(pluginEntry({ sourceUrl: undefined }) as never)

		assert.deepStrictEqual(installPluginStub.firstCall.args[0], { source: "tokeneconomizer" })
	})
})
