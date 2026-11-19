import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMarketplaceCatalog } from "@cline/core";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadMarketplaceCatalog", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function writePriorityCatalog(content: unknown): string {
		const dir = mkdtempSync(join(tmpdir(), "marketplace-catalog-"));
		tempDirs.push(dir);
		const path = join(dir, "catalog.json");
		writeFileSync(path, JSON.stringify(content));
		return path;
	}

	function remoteFetch(body: unknown) {
		return vi.fn(
			async () =>
				new Response(JSON.stringify(body), {
					headers: { "content-type": "application/json" },
				}),
		);
	}

	it("places priority-source entries ahead of remote entries", async () => {
		const priorityPath = writePriorityCatalog({
			version: 1,
			entries: [{ id: "alpha", type: "skill" }],
		});
		const catalog = await loadMarketplaceCatalog({
			prioritySource: priorityPath,
			fetchImpl: remoteFetch({
				version: 1,
				entries: [
					{ id: "beta", type: "mcp", featured: true },
					{ id: "gamma", type: "skill" },
				],
			}),
		});

		expect(
			(catalog.entries as Array<{ id: string }>).map((entry) => entry.id),
		).toEqual(["alpha", "beta", "gamma"]);
	});

	it("keeps the priority version when type and id collide with the remote catalog", async () => {
		const priorityPath = writePriorityCatalog({
			version: 1,
			entries: [{ id: "shared", type: "mcp", name: "Priority name" }],
		});
		const catalog = await loadMarketplaceCatalog({
			prioritySource: priorityPath,
			fetchImpl: remoteFetch({
				version: 1,
				entries: [{ id: "shared", type: "mcp", name: "Remote name" }],
			}),
		});

		expect(catalog.entries).toEqual([
			{ id: "shared", type: "mcp", name: "Priority name", sourceIndex: 0 },
		]);
	});

	it("does not treat the same id under a different type as a duplicate", async () => {
		const priorityPath = writePriorityCatalog({
			version: 1,
			entries: [{ id: "shared", type: "skill" }],
		});
		const catalog = await loadMarketplaceCatalog({
			prioritySource: priorityPath,
			fetchImpl: remoteFetch({
				version: 1,
				entries: [{ id: "shared", type: "mcp" }],
			}),
		});

		expect(
			(catalog.entries as Array<{ type: string }>).map((entry) => entry.type),
		).toEqual(["skill", "mcp"]);
	});

	it("recounts entries by type across both sources", async () => {
		const priorityPath = writePriorityCatalog({
			version: 1,
			entries: [{ id: "a", type: "skill" }],
		});
		const catalog = await loadMarketplaceCatalog({
			prioritySource: priorityPath,
			fetchImpl: remoteFetch({
				version: 1,
				counts: { total: 99, mcps: 99, plugins: 99, skills: 99 },
				entries: [
					{ id: "b", type: "mcp" },
					{ id: "c", type: "mcp" },
				],
			}),
		});

		expect(catalog.counts).toEqual({
			total: 3,
			mcps: 2,
			plugins: 0,
			skills: 1,
		});
	});

	it("takes top-level metadata from the remote catalog, not the priority file", async () => {
		const priorityPath = writePriorityCatalog({
			version: 1,
			baseUrl: "https://example.com/priority",
			entries: [],
		});
		const catalog = await loadMarketplaceCatalog({
			prioritySource: priorityPath,
			fetchImpl: remoteFetch({
				version: 1,
				baseUrl: "https://cline.github.io/marketplace",
				entries: [],
			}),
		});

		expect(catalog.baseUrl).toBe("https://cline.github.io/marketplace");
	});

	it("merges tags by id, keeping the first occurrence", async () => {
		const priorityPath = writePriorityCatalog({
			version: 1,
			tags: [{ id: "software", label: "Priority label" }],
			entries: [],
		});
		const catalog = await loadMarketplaceCatalog({
			prioritySource: priorityPath,
			fetchImpl: remoteFetch({
				version: 1,
				tags: [
					{ id: "software", label: "Remote label" },
					{ id: "data", label: "Data" },
				],
				entries: [],
			}),
		});

		expect(catalog.tags).toEqual([
			{ id: "software", label: "Priority label" },
			{ id: "data", label: "Data" },
		]);
	});

	it("skips malformed priority entries instead of failing the load", async () => {
		const priorityPath = writePriorityCatalog({
			version: 1,
			entries: [null, { id: 42, type: "skill" }, { id: "ok", type: "skill" }],
		});
		const catalog = await loadMarketplaceCatalog({
			prioritySource: priorityPath,
			fetchImpl: remoteFetch({ version: 1, entries: [] }),
		});

		expect(
			(catalog.entries as Array<{ id: string }>).map((entry) => entry.id),
		).toEqual(["ok"]);
	});

	it("falls back to the remote catalog alone when the priority file is missing", async () => {
		const catalog = await loadMarketplaceCatalog({
			prioritySource: join(tmpdir(), "does-not-exist-catalog.json"),
			fetchImpl: remoteFetch({
				version: 1,
				entries: [{ id: "only", type: "plugin" }],
			}),
		});

		expect(catalog.entries).toEqual([
			{ id: "only", type: "plugin", sourceIndex: 0 },
		]);
	});

	it("falls back to the remote catalog when the priority file is not valid JSON", async () => {
		const dir = mkdtempSync(join(tmpdir(), "marketplace-catalog-"));
		tempDirs.push(dir);
		const path = join(dir, "catalog.json");
		writeFileSync(path, "{ not json");
		const catalog = await loadMarketplaceCatalog({
			prioritySource: path,
			fetchImpl: remoteFetch({
				version: 1,
				entries: [{ id: "only", type: "skill" }],
			}),
		});

		expect(catalog.entries).toEqual([
			{ id: "only", type: "skill", sourceIndex: 0 },
		]);
	});

	it("surfaces remote failures instead of hiding them behind the priority file", async () => {
		const priorityPath = writePriorityCatalog({ version: 1, entries: [] });
		const fetchImpl = vi.fn(
			async () =>
				new Response("nope", { status: 503, statusText: "Unavailable" }),
		);

		await expect(
			loadMarketplaceCatalog({
				prioritySource: priorityPath,
				fetchImpl,
			}),
		).rejects.toThrow("Failed to fetch marketplace catalog: 503 Unavailable");
	});
});
