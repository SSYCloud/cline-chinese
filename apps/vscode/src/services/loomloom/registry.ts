import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { SkillBot } from "@shared/loomloom"

/** Pins are independent of downloaded executable Agent Skill packages. */
export class SkillBotRegistry {
	private queue: Promise<unknown> = Promise.resolve()
	constructor(
		private readonly file: string,
		private readonly seed: () => string[] = () => [],
	) {}
	async list(): Promise<{ id: string; name?: string }[]> {
		try {
			return JSON.parse(await readFile(this.file, "utf8"))
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e
			return this.seed().map((id) => ({ id }))
		}
	}
	async set(listing: SkillBot, installed: boolean) {
		const action = this.queue
			.catch(() => {})
			.then(async () => {
				const entries = (await this.list()).filter((e) => e.id !== listing.id)
				if (installed) entries.push({ id: listing.id, name: listing.name })
				await mkdir(path.dirname(this.file), { recursive: true })
				const temporary = `${this.file}.${randomUUID()}.tmp`
				await writeFile(temporary, JSON.stringify(entries), { mode: 0o600 })
				await rename(temporary, this.file)
			})
		this.queue = action
		await action
	}
}
