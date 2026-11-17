import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	loadMarketplaceCatalog,
	mergeMarketplaceCatalogs,
} from "./marketplace-catalog";

describe("mergeMarketplaceCatalogs", () => {
	it("keeps priority entries first and drops remote duplicates of the same type and id", () => {
		const merged = mergeMarketplaceCatalogs([
			{ entries: [{ id: "shared", type: "skill", name: "Priority" }] },
			{
				entries: [
					{ id: "shared", type: "skill", name: "Remote" },
					{ id: "other", type: "mcp" },
				],
			},
		]);

		expect(merged.entries).toEqual([
			{ id: "shared", type: "skill", name: "Priority", sourceIndex: 0 },
			{ id: "other", type: "mcp", sourceIndex: 1 },
		]);
	});

	it("treats the same id under a different type as a separate entry", () => {
		const merged = mergeMarketplaceCatalogs([
			{ entries: [{ id: "x", type: "skill" }] },
			{ entries: [{ id: "x", type: "mcp" }] },
		]);

		expect(
			(merged.entries as Array<{ type: string }>).map((entry) => entry.type),
		).toEqual(["skill", "mcp"]);
	});

	it("recounts entries by type instead of trusting upstream counts", () => {
		const merged = mergeMarketplaceCatalogs([
			{ entries: [{ id: "a", type: "skill" }] },
			{
				counts: { total: 99, mcps: 99, plugins: 99, skills: 99 },
				entries: [
					{ id: "b", type: "mcp" },
					{ id: "c", type: "plugin" },
				],
			},
		]);

		expect(merged.counts).toEqual({ total: 3, mcps: 1, plugins: 1, skills: 1 });
	});

	it("takes top-level metadata from the last catalog and dedupes tags by id", () => {
		const merged = mergeMarketplaceCatalogs([
			{
				baseUrl: "https://priority.example",
				tags: [{ id: "software", label: "Priority" }],
			},
			{
				baseUrl: "https://remote.example",
				tags: [
					{ id: "software", label: "Remote" },
					{ id: "data", label: "Data" },
				],
			},
		]);

		expect(merged.baseUrl).toBe("https://remote.example");
		expect(merged.tags).toEqual([
			{ id: "software", label: "Priority" },
			{ id: "data", label: "Data" },
		]);
	});

	it("skips entries missing a string id or type", () => {
		const merged = mergeMarketplaceCatalogs([
			{
				entries: [
					null,
					{ id: 1, type: "skill" },
					{ id: "ok", type: "skill" },
					"text",
				],
			},
		]);

		expect(
			(merged.entries as Array<{ id: string }>).map((entry) => entry.id),
		).toEqual(["ok"]);
	});
});

describe("loadMarketplaceCatalog", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	function writeLocalCatalog(content: string): string {
		const dir = mkdtempSync(join(tmpdir(), "core-marketplace-catalog-"));
		tempDirs.push(dir);
		const path = join(dir, "catalog.json");
		writeFileSync(path, content);
		return path;
	}

	function jsonFetch(body: unknown) {
		return vi.fn(
			async () =>
				new Response(JSON.stringify(body), {
					headers: { "content-type": "application/json" },
				}),
		);
	}

	it("reads a GitHub blob priority source through its raw URL", async () => {
		const fetchImpl = vi.fn(async (url: string | URL | Request) => {
			if (String(url).startsWith("https://raw.githubusercontent.com/")) {
				return new Response(
					JSON.stringify({ entries: [{ id: "pri", type: "skill" }] }),
				);
			}
			return new Response(
				JSON.stringify({ entries: [{ id: "rem", type: "mcp" }] }),
			);
		});

		const catalog = await loadMarketplaceCatalog({
			fetchImpl,
			remoteUrl: "https://remote.example/catalog.json",
			prioritySource: "https://github.com/acme/repo/blob/main/catalog.json",
		});

		expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(
			expect.arrayContaining([
				"https://raw.githubusercontent.com/acme/repo/main/catalog.json",
				"https://remote.example/catalog.json",
			]),
		);
		expect(
			(catalog.entries as Array<{ id: string }>).map((entry) => entry.id),
		).toEqual(["pri", "rem"]);
	});

	it("reads a local file priority source", async () => {
		const prioritySource = writeLocalCatalog(
			JSON.stringify({ entries: [{ id: "local", type: "plugin" }] }),
		);

		const catalog = await loadMarketplaceCatalog({
			fetchImpl: jsonFetch({ entries: [{ id: "rem", type: "skill" }] }),
			remoteUrl: "https://remote.example/catalog.json",
			prioritySource,
		});

		expect(
			(catalog.entries as Array<{ id: string }>).map((entry) => entry.id),
		).toEqual(["local", "rem"]);
	});

	it("falls back to the remote catalog and reports the error when the priority file is not valid JSON", async () => {
		const prioritySource = writeLocalCatalog("{ not json");
		const onPrioritySourceError = vi.fn();

		const catalog = await loadMarketplaceCatalog({
			fetchImpl: jsonFetch({ entries: [{ id: "rem", type: "skill" }] }),
			remoteUrl: "https://remote.example/catalog.json",
			prioritySource,
			onPrioritySourceError,
		});

		expect(onPrioritySourceError).toHaveBeenCalledWith(
			prioritySource,
			expect.any(SyntaxError),
		);
		expect(
			(catalog.entries as Array<{ id: string }>).map((entry) => entry.id),
		).toEqual(["rem"]);
	});

	it("falls back to the remote catalog when the priority source returns a non-OK response", async () => {
		const onPrioritySourceError = vi.fn();
		const fetchImpl = vi.fn(async (url: string | URL | Request) => {
			if (String(url).startsWith("https://raw.githubusercontent.com/")) {
				return new Response("missing", {
					status: 404,
					statusText: "Not Found",
				});
			}
			return new Response(
				JSON.stringify({ entries: [{ id: "rem", type: "skill" }] }),
			);
		});

		const catalog = await loadMarketplaceCatalog({
			fetchImpl,
			remoteUrl: "https://remote.example/catalog.json",
			prioritySource: "https://github.com/acme/repo/blob/main/catalog.json",
			onPrioritySourceError,
		});

		expect(onPrioritySourceError).toHaveBeenCalledWith(
			"https://github.com/acme/repo/blob/main/catalog.json",
			expect.objectContaining({
				message: "Failed to fetch marketplace catalog: 404 Not Found",
			}),
		);
		expect(
			(catalog.entries as Array<{ id: string }>).map((entry) => entry.id),
		).toEqual(["rem"]);
	});

	it("skips the priority source entirely when it is null", async () => {
		const fetchImpl = jsonFetch({ entries: [{ id: "rem", type: "skill" }] });

		await loadMarketplaceCatalog({
			fetchImpl,
			remoteUrl: "https://remote.example/catalog.json",
			prioritySource: null,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledWith(
			"https://remote.example/catalog.json",
			{
				headers: { Accept: "application/json" },
			},
		);
	});

	it("throws when the remote catalog fails, even if the priority source loads", async () => {
		const prioritySource = writeLocalCatalog(JSON.stringify({ entries: [] }));
		const fetchImpl = vi.fn(
			async () =>
				new Response("down", { status: 503, statusText: "Unavailable" }),
		);

		await expect(
			loadMarketplaceCatalog({
				fetchImpl,
				remoteUrl: "https://remote.example/catalog.json",
				prioritySource,
			}),
		).rejects.toThrow("Failed to fetch marketplace catalog: 503 Unavailable");
	});
});
