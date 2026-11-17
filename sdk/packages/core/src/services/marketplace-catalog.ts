import { readFile } from "node:fs/promises";

export type MarketplaceCatalogFetch = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export type MarketplaceCatalogRecord = {
	entries?: unknown;
	tags?: unknown;
	[key: string]: unknown;
};

export const MARKETPLACE_CATALOG_URL =
	process.env.CLINE_MARKETPLACE_CATALOG_URL?.trim() ||
	"https://cline.github.io/marketplace/catalog.json";

export const PRIORITY_MARKETPLACE_CATALOG_SOURCE =
	"https://github.com/shengsuan/agent-craft/blob/main/catalog.json";

export type LoadMarketplaceCatalogOptions = {
	fetchImpl?: MarketplaceCatalogFetch;
	remoteUrl?: string;
	prioritySource?: string | null;
	onPrioritySourceError?: (source: string, error: unknown) => void;
};

function toRawGithubUrl(source: string): string {
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(
		source,
	);
	return match
		? `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`
		: source;
}

async function fetchCatalogJson(
	url: string,
	fetchImpl: MarketplaceCatalogFetch,
): Promise<unknown> {
	const response = await fetchImpl(url, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(
			`Failed to fetch marketplace catalog: ${response.status} ${response.statusText}`.trim(),
		);
	}
	return response.json();
}

async function readPrioritySource(
	source: string,
	fetchImpl: MarketplaceCatalogFetch,
): Promise<unknown> {
	if (/^https?:\/\//.test(source)) {
		return fetchCatalogJson(toRawGithubUrl(source), fetchImpl);
	}
	return JSON.parse(await readFile(source, "utf8"));
}

function isRecord(value: unknown): value is MarketplaceCatalogRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Entries from the priority source come first. A type and id pair that appears in both
 * sources keeps only the priority copy, so the same skill is never listed twice.
 * Top-level metadata (baseUrl, generatedAt, ...) comes from the remote catalog.
 */
export function mergeMarketplaceCatalogs(
	catalogs: MarketplaceCatalogRecord[],
): MarketplaceCatalogRecord {
	const metadataSource = catalogs.at(-1) ?? {};
	const seenEntryKeys = new Set<string>();
	const seenTagIds = new Set<string>();
	const entries: Record<string, unknown>[] = [];
	const tags: Record<string, unknown>[] = [];
	catalogs.forEach((catalog, sourceIndex) => {
		for (const entry of Array.isArray(catalog.entries) ? catalog.entries : []) {
			if (
				!isRecord(entry) ||
				typeof entry.id !== "string" ||
				typeof entry.type !== "string"
			)
				continue;
			const key = `${entry.type}:${entry.id}`;
			if (seenEntryKeys.has(key)) continue;
			seenEntryKeys.add(key);
			entries.push({ ...entry, sourceIndex });
		}
		for (const tag of Array.isArray(catalog.tags) ? catalog.tags : []) {
			if (
				!isRecord(tag) ||
				typeof tag.id !== "string" ||
				seenTagIds.has(tag.id)
			)
				continue;
			seenTagIds.add(tag.id);
			tags.push(tag);
		}
	});
	const counts = { total: entries.length, mcps: 0, plugins: 0, skills: 0 };
	for (const entry of entries) {
		if (entry.type === "mcp") counts.mcps++;
		else if (entry.type === "plugin") counts.plugins++;
		else if (entry.type === "skill") counts.skills++;
	}
	return { ...metadataSource, counts, tags, entries };
}

/**
 * The priority source is optional. If it cannot be read, the remote catalog is used alone and
 * `onPrioritySourceError` is called. A failing remote catalog always throws.
 */
export async function loadMarketplaceCatalog(
	options: LoadMarketplaceCatalogOptions = {},
): Promise<MarketplaceCatalogRecord> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const remoteUrl = options.remoteUrl ?? MARKETPLACE_CATALOG_URL;
	const prioritySource =
		options.prioritySource === undefined
			? PRIORITY_MARKETPLACE_CATALOG_SOURCE
			: options.prioritySource;
	const [priority, remote] = await Promise.all([
		prioritySource
			? readPrioritySource(prioritySource, fetchImpl).then(
					(value) => (isRecord(value) ? value : undefined),
					(error: unknown) => {
						options.onPrioritySourceError?.(prioritySource, error);
						return undefined;
					},
				)
			: Promise.resolve(undefined),
		fetchCatalogJson(remoteUrl, fetchImpl),
	]);
	const remoteCatalog = isRecord(remote) ? remote : {};
	return mergeMarketplaceCatalogs(
		priority ? [priority, remoteCatalog] : [remoteCatalog],
	);
}
