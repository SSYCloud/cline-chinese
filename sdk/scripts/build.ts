#!/usr/bin/env bun

/**
 * Build all SDK packages in topological dependency order.
 *
 * Reads workspace package.json files, resolves @coohu/* inter-dependencies,
 * and runs `bun run build` in each package directory in the correct order.
 *
 * Usage:
 *   bun run scripts/build.ts           # build all packages
 *   bun run scripts/build.ts --filter shared llms  # build specific packages
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Glob } from "bun";

// Two levels up from sdk/scripts/ → repo root
const root = path.join(import.meta.dir, "..", "..");

type PackageJson = {
	name?: string;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

type Package = {
	name: string;
	dir: string;
	deps: string[]; // @coohu/* names this package depends on
};

async function readWorkspaceGlobs(): Promise<string[]> {
	const raw = await readFile(path.join(root, "package.json"), "utf8");
	const pkg = JSON.parse(raw) as { workspaces?: string[] };
	return pkg.workspaces ?? [];
}

async function expandWorkspaceDirs(globs: string[]): Promise<string[]> {
	const dirs = new Set<string>();
	for (const pattern of globs) {
		const glob = new Glob(pattern.replaceAll("\\", "/"));
		for await (const match of glob.scan({ cwd: root, onlyFiles: false, absolute: false })) {
			const absolute = path.join(root, match);
			try {
				const info = await stat(absolute);
				if (info.isDirectory()) dirs.add(absolute);
			} catch {
				// ignore missing
			}
		}
	}
	return [...dirs].sort();
}

async function loadPackage(dir: string): Promise<Package | null> {
	const pkgPath = path.join(dir, "package.json");
	let raw: string;
	try {
		raw = await readFile(pkgPath, "utf8");
	} catch {
		return null;
	}
	const pkg = JSON.parse(raw) as PackageJson;
	if (!pkg.name?.startsWith("@coohu/")) return null;
	if (!pkg.scripts?.build) return null;

	const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
	const internalDeps = Object.keys(allDeps).filter((d) => d.startsWith("@coohu/"));

	return { name: pkg.name, dir, deps: internalDeps };
}

/** Kahn's algorithm topological sort */
function topoSort(packages: Package[]): Package[] {
	const byName = new Map(packages.map((p) => [p.name, p]));
	const inDegree = new Map(packages.map((p) => [p.name, 0]));

	for (const pkg of packages) {
		for (const dep of pkg.deps) {
			if (byName.has(dep)) {
				inDegree.set(pkg.name, (inDegree.get(pkg.name) ?? 0) + 1);
			}
		}
	}

	const queue = packages.filter((p) => inDegree.get(p.name) === 0);
	const sorted: Package[] = [];

	while (queue.length > 0) {
		const current = queue.shift()!;
		sorted.push(current);
		for (const pkg of packages) {
			if (pkg.deps.includes(current.name)) {
				const newDeg = (inDegree.get(pkg.name) ?? 0) - 1;
				inDegree.set(pkg.name, newDeg);
				if (newDeg === 0) queue.push(pkg);
			}
		}
	}

	if (sorted.length !== packages.length) {
		const remaining = packages.filter((p) => !sorted.includes(p)).map((p) => p.name);
		throw new Error(`Cyclic dependency detected among: ${remaining.join(", ")}`);
	}

	return sorted;
}

async function buildPackage(pkg: Package): Promise<void> {
	const rel = path.relative(root, pkg.dir);
	console.log(`\n▶ building ${pkg.name}  (${rel})`);
	const start = Date.now();

	const proc = Bun.spawn(["bun", "run", "build"], {
		cwd: pkg.dir,
		stdout: "inherit",
		stderr: "inherit",
		env: { ...process.env },
	});

	const exitCode = await proc.exited;
	const elapsed = ((Date.now() - start) / 1000).toFixed(1);

	if (exitCode !== 0) {
		throw new Error(`${pkg.name} build failed (exit ${exitCode}) after ${elapsed}s`);
	}
	console.log(`✓ ${pkg.name} done in ${elapsed}s`);
}

async function main(): Promise<void> {
	// --filter name1 name2 … allows building a subset (short names or full @coohu/name)
	const filterArg = process.argv.indexOf("--filter");
	const filterSet =
		filterArg >= 0
			? new Set(
					process.argv
						.slice(filterArg + 1)
						.map((n) => (n.startsWith("@coohu/") ? n : `@coohu/${n}`)),
			  )
			: null;

	const globs = await readWorkspaceGlobs();
	const dirs = await expandWorkspaceDirs(globs);

	const packages: Package[] = [];
	for (const dir of dirs) {
		const pkg = await loadPackage(dir);
		if (pkg) packages.push(pkg);
	}

	const sorted = topoSort(packages);
	const targets = filterSet ? sorted.filter((p) => filterSet.has(p.name)) : sorted;

	if (targets.length === 0) {
		console.error("No matching packages found.");
		process.exit(1);
	}

	console.log(`Building ${targets.length} package(s) in order:`);
	for (const pkg of targets) console.log(`  • ${pkg.name}`);

	const totalStart = Date.now();
	for (const pkg of targets) {
		await buildPackage(pkg);
	}

	const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
	console.log(`\n✅ all ${targets.length} package(s) built in ${totalElapsed}s`);
}

await main();
