import { describe, expect, it } from "vitest";
import { getMcpDescription } from "./interactive-config";

describe("getMcpDescription", () => {
	it("shows one configured timeout when it also applies to initialize", () => {
		expect(
			getMcpDescription({
				name: "local",
				transport: { type: "stdio", command: "node" },
				timeoutSeconds: 120,
			}),
		).toBe("stdio, 本地, 超时 120秒");
	});

	it("reports malformed programmatic timeouts as unconfigured", () => {
		const transport = { type: "stdio", command: "node" } as const;
		expect(
			getMcpDescription({
				name: "local",
				transport,
				timeoutSeconds: Number.NaN,
			}),
		).toBe(getMcpDescription({ name: "local", transport }));
	});
});
