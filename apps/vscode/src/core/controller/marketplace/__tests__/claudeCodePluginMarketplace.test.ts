import { afterEach, describe, it, mock } from "bun:test"
import * as assert from "assert"
import sinon from "sinon"

const installClaudePluginStub = sinon.stub()
const listClaudeMarketplaceCatalogStub = sinon.stub()
const installPluginStub = sinon.stub()
const loadMarketplaceCatalogStub = sinon.stub().resolves({ entries: [] })

const actualCore = await import("@cline/core")

mock.module("@cline/core", () => {
	return {
		...actualCore,
		installClaudePlugin: installClaudePluginStub,
		listClaudeMarketplaceCatalog: listClaudeMarketplaceCatalogStub,
		installPlugin: installPluginStub,
		loadMarketplaceCatalog: loadMarketplaceCatalogStub,
	}
})

describe("Claude Code plugins in the marketplace", () => {
	afterEach(() => {
		installClaudePluginStub.reset()
		listClaudeMarketplaceCatalogStub.reset()
		installPluginStub.reset()
		loadMarketplaceCatalogStub.reset()
		loadMarketplaceCatalogStub.resolves({ entries: [] })
	})

	it("installs a Claude catalog entry through the Claude CLI and never through the Cline plugin installer", async () => {
		const { installMarketplaceEntryFromCatalog } = await import("../marketplace-helpers")
		installClaudePluginStub.resolves({ pluginId: "fast-jev@m", installed: true, message: "Installed fast-jev" })

		const result = await installMarketplaceEntryFromCatalog({
			id: "claude:fast-jev@m",
			type: "plugin",
			name: "fast-jev",
			tags: [],
			tagObjects: [],
			install: { args: ["fast-jev@m"], env: [], command: "claude-code" },
		} as never)

		assert.ok(installClaudePluginStub.calledOnceWithExactly("fast-jev@m"))
		assert.ok(installPluginStub.notCalled)
		assert.strictEqual(result.status, "installed")
		assert.strictEqual(result.message, "Installed fast-jev with Claude Code.")
	})

	it("turns a refused Claude install into an error carrying the CLI's reason", async () => {
		const { installMarketplaceEntryFromCatalog } = await import("../marketplace-helpers")
		installClaudePluginStub.resolves({
			pluginId: "zz@m",
			installed: false,
			message: "Plugin not found in marketplace",
			failureCode: "not_found",
		})

		await assert.rejects(
			installMarketplaceEntryFromCatalog({
				id: "claude:zz@m",
				type: "plugin",
				name: "zz",
				tags: [],
				tagObjects: [],
				install: { args: ["zz@m"], env: [], command: "claude-code" },
			} as never),
			/Could not install zz: Plugin not found in marketplace/,
		)
	})

	it("adds Claude available plugins to the catalog as plugin entries with a namespaced id", async () => {
		const { fetchMarketplaceCatalog } = await import("../marketplace-helpers")
		listClaudeMarketplaceCatalogStub.resolves({
			available: [{ pluginId: "fast-jev@m", name: "fast-jev", marketplaceName: "m", description: "Compaction" }],
			installed: [],
		})

		const catalog = await fetchMarketplaceCatalog()
		const claude = catalog.entries.filter((entry) => entry.install?.command === "claude-code")

		assert.deepStrictEqual(
			claude.map((entry) => ({ id: entry.id, type: entry.type, args: entry.install?.args })),
			[{ id: "claude:fast-jev@m", type: "plugin", args: ["fast-jev@m"] }],
		)
	})

	it("keeps the Cline catalog loading when Claude Code is unavailable", async () => {
		const { fetchMarketplaceCatalog } = await import("../marketplace-helpers")
		listClaudeMarketplaceCatalogStub.rejects(new Error("claude not found"))

		const catalog = await fetchMarketplaceCatalog()

		assert.ok(Array.isArray(catalog.entries))
		assert.strictEqual(catalog.entries.filter((entry) => entry.install?.command === "claude-code").length, 0)
	})
})
