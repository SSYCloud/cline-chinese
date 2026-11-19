import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ClaudeCliError,
	installClaudePlugin,
	listClaudeMarketplaceCatalog,
} from "./marketplace";

const originalPath = process.env.PATH;
let stubDir: string;

beforeEach(async () => {
	stubDir = await realpath(await mkdtemp(join(tmpdir(), "claude-stub-")));
	process.env.PATH = `${stubDir}:${originalPath ?? ""}`;
});

afterEach(async () => {
	process.env.PATH = originalPath;
	await rm(stubDir, { recursive: true, force: true });
});

async function installStub(script: string): Promise<void> {
	const path = join(stubDir, "claude");
	await writeFile(path, `#!/bin/sh\n${script}\n`);
	await chmod(path, 0o755);
}

describe("listClaudeMarketplaceCatalog", () => {
	it("returns available and installed plugins from the CLI's JSON, skipping malformed rows", async () => {
		await installStub(`cat <<'JSON'
{"installed":[{"id":"a@m","version":"1.0.0","enabled":true,"installPath":"/x/a"},{"enabled":true}],
 "available":[{"pluginId":"b@m","name":"b","marketplaceName":"m","description":"B plugin","installCount":7},{"name":"no-id"}]}
JSON`);

		const catalog = await listClaudeMarketplaceCatalog();

		expect(catalog).toEqual({
			available: [
				{
					pluginId: "b@m",
					name: "b",
					marketplaceName: "m",
					description: "B plugin",
					installCount: 7,
				},
			],
			installed: [
				{ id: "a@m", version: "1.0.0", enabled: true, installPath: "/x/a" },
			],
		});
	});

	it("reports an unavailable CLI with a clear error when claude is not on PATH", async () => {
		process.env.PATH = stubDir;

		await expect(listClaudeMarketplaceCatalog()).rejects.toMatchObject({
			name: "ClaudeCliError",
			code: "unavailable",
			message: "Claude Code CLI ('claude') was not found on PATH.",
		});
	});

	it("rejects output that is not JSON as invalid-output", async () => {
		await installStub("echo 'not json at all'");

		await expect(listClaudeMarketplaceCatalog()).rejects.toBeInstanceOf(
			ClaudeCliError,
		);
		await expect(listClaudeMarketplaceCatalog()).rejects.toMatchObject({
			code: "invalid-output",
		});
	});

	it("surfaces stderr when the CLI exits non-zero", async () => {
		await installStub("echo 'marketplace offline' >&2; exit 3");

		await expect(listClaudeMarketplaceCatalog()).rejects.toMatchObject({
			code: "failed",
			message: "marketplace offline",
		});
	});
});

describe("installClaudePlugin", () => {
	it("reports success when the CLI returns outcome ok", async () => {
		await installStub(
			`echo '{"command":"install","outcome":"ok","plugin":"b@m","message":"Installed b"}'`,
		);

		await expect(installClaudePlugin("b@m")).resolves.toEqual({
			pluginId: "b@m",
			installed: true,
			message: "Installed b",
		});
	});

	it("reports a failed install with its failure code, without throwing", async () => {
		await installStub(
			`echo '{"command":"install","outcome":"failed","message":"not found","failureCode":"not_found"}'; exit 1`,
		);

		await expect(installClaudePlugin("zz@m")).resolves.toEqual({
			pluginId: "zz@m",
			installed: false,
			message: "not found",
			failureCode: "not_found",
		});
	});

	it("rejects an id that could be read as a flag or path before running anything", async () => {
		await installStub(
			`echo "ran" > ${join(stubDir, "ran.txt")}; echo '{"outcome":"ok"}'`,
		);

		await expect(installClaudePlugin("--evil; rm -rf /")).rejects.toMatchObject(
			{ code: "failed" },
		);
		await expect(installClaudePlugin("no-marketplace")).rejects.toMatchObject({
			code: "failed",
		});
		await expect(
			(async () => {
				const { stat } = await import("node:fs/promises");
				return stat(join(stubDir, "ran.txt"));
			})(),
		).rejects.toThrow();
	});
});
