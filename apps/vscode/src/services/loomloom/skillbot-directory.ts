import type { SkillBot } from "@shared/loomloom"
import type { LoomLoomClient } from "./client"
import type { SkillBotRegistry } from "./registry"

/** One catalog boundary for UI and Agent. Installation and runtime data are not copied into a second store. */
export class SkillBotDirectory {
	private known = new Map<string, SkillBot>()
	constructor(
		private readonly api: Pick<LoomLoomClient, "catalog" | "detail">,
		private readonly registry: Pick<SkillBotRegistry, "list" | "set">,
	) {}
	async installedSummary() {
		return (await this.registry.list()).map((pin) => ({ id: pin.id, name: this.known.get(pin.id)?.name || pin.name || null }))
	}
	async list(input: { installed?: boolean; page?: number; keyword?: string; pageToken?: string }) {
		const pins = await this.registry.list()
		if (input.installed) {
			const visible = pins.slice((input.page ?? 0) * 5, (input.page ?? 0) * 5 + 5)
			const items = await Promise.all(
				visible.map(async (pin) => {
					try {
						return await this.inspect(pin.id)
					} catch {
						return {
							id: pin.id,
							name: pin.name || pin.id,
							description: "暂时无法加载详情，请刷新。",
							availability: "unknown",
							versionId: "",
						} satisfies SkillBot
					}
				}),
			)
			return {
				items,
				installedIds: pins.map((p) => p.id),
				pages: Math.max(1, Math.ceil(pins.length / 5)),
				nextPageToken: "",
			}
		}
		const page = await this.api.catalog(input.keyword, input.pageToken)
		for (const item of page.items) this.known.set(item.id, item)
		return { ...page, installedIds: pins.map((p) => p.id) }
	}
	async inspect(id: string) {
		const item = await this.api.detail(id)
		this.known.set(id, item)
		return item
	}
	async pin(id: string, installed: boolean) {
		const item = installed
			? await this.inspect(id)
			: { id, name: "", description: "", availability: "unknown", versionId: "" }
		await this.registry.set(item, installed)
	}
}
