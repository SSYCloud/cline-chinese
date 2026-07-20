import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listLocalProviders: vi.fn(async () => ({ providers: [], settingsPath: "" })),
}));

vi.mock("@coohu/core", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@coohu/core")>();
	return {
		...actual,
		listLocalProviders: mocks.listLocalProviders,
	};
});

describe("listLocalProviders", () => {
	it("enables ClinePass when listing the SDK provider list", async () => {
		const { listLocalProviders } = await import("./provider-catalog");
		const manager = {} as never;

		await listLocalProviders(manager);

		expect(mocks.listLocalProviders).toHaveBeenCalledWith(manager, {
			isClinePassEnabled: true,
		});
	});
});
