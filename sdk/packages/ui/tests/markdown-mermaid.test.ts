import { describe, expect, test, vi } from "vitest";
import {
	createLazyMermaidPlugin,
	DIAGRAM_LINK_HREF_ATTRIBUTE,
	type MermaidModuleLoader,
	neutralizeDiagramLinks,
} from "../components/markdown";

function createRenderer() {
	return {
		initialize: vi.fn(),
		render: vi.fn(async (id: string, source: string) => ({
			svg: `<svg data-id="${id}">${source}</svg>`,
		})),
	};
}

describe("createLazyMermaidPlugin", () => {
	test("does not load Mermaid until the first diagram render", async () => {
		const renderer = createRenderer();
		const loader = vi.fn<MermaidModuleLoader>(async () => ({
			default: renderer,
		}));
		const plugin = createLazyMermaidPlugin(loader);

		expect(plugin).toMatchObject({
			language: "mermaid",
			name: "mermaid",
			type: "diagram",
		});
		expect(loader).not.toHaveBeenCalled();

		const instance = plugin.getMermaid();
		expect(loader).not.toHaveBeenCalled();
		await expect(
			instance.render("diagram-1", "flowchart LR\nA --> B"),
		).resolves.toEqual({
			svg: '<svg data-id="diagram-1">flowchart LR\nA --> B</svg>',
		});

		expect(loader).toHaveBeenCalledOnce();
		expect(renderer.initialize).toHaveBeenCalledOnce();
		expect(renderer.initialize).toHaveBeenCalledWith(
			expect.objectContaining({
				securityLevel: "strict",
				startOnLoad: false,
				suppressErrorRendering: true,
				theme: "base",
				themeVariables: expect.objectContaining({ darkMode: false }),
			}),
		);
		expect(renderer.render).toHaveBeenCalledWith(
			"diagram-1",
			"flowchart LR\nA --> B",
		);
	});

	test("initializes once until Streamdown supplies new diagram config", async () => {
		const renderer = createRenderer();
		const loader = vi.fn<MermaidModuleLoader>(async () => ({
			default: renderer,
		}));
		const plugin = createLazyMermaidPlugin(loader);
		const instance = plugin.getMermaid();

		await instance.render("one", "flowchart LR\nA --> B");
		await instance.render("two", "flowchart LR\nB --> C");
		expect(loader).toHaveBeenCalledTimes(1);
		expect(renderer.initialize).toHaveBeenCalledTimes(1);

		const reconfigured = plugin.getMermaid({
			securityLevel: "loose",
			theme: "dark",
		});
		await reconfigured.render("three", "flowchart LR\nC --> D");
		expect(renderer.initialize).toHaveBeenCalledTimes(2);
		expect(renderer.initialize).toHaveBeenLastCalledWith(
			expect.objectContaining({ securityLevel: "strict", theme: "dark" }),
		);
	});

	test("surfaces Mermaid render failures for Streamdown to handle safely", async () => {
		const error = new Error("invalid diagram");
		const renderer = {
			initialize: vi.fn(),
			render: vi.fn(async () => {
				throw error;
			}),
		};
		const plugin = createLazyMermaidPlugin(async () => ({ default: renderer }));

		await expect(
			plugin.getMermaid().render("invalid", "flowchart LR\nA -->"),
		).rejects.toBe(error);
		expect(renderer.initialize).toHaveBeenCalledWith(
			expect.objectContaining({ securityLevel: "strict" }),
		);
	});

	// This file runs under the package's default `node` environment, where
	// `DOMParser` is absent, so these exercise the pattern-based fallback.
	// `markdown-diagram-links.test.ts` covers the DOM parser path under jsdom.
	describe("neutralizeDiagramLinks (pattern fallback path)", () => {
		test("drops non-http(s) destinations without preserving them", () => {
			const sanitized = neutralizeDiagramLinks(
				`<svg><a href="javascript:alert(1)"><text>x</text></a></svg>`,
			);

			expect(sanitized.toLowerCase()).not.toContain("javascript:");
			expect(sanitized).not.toContain(DIAGRAM_LINK_HREF_ATTRIBUTE);
		});
	});

	test("retries the lazy import after a chunk load failure", async () => {
		const renderer = createRenderer();
		const error = new Error("chunk unavailable");
		const loader = vi
			.fn<MermaidModuleLoader>()
			.mockRejectedValueOnce(error)
			.mockResolvedValueOnce({ default: renderer });
		const instance = createLazyMermaidPlugin(loader).getMermaid();

		await expect(
			instance.render("first", "flowchart LR\nA --> B"),
		).rejects.toBe(error);
		await expect(
			instance.render("second", "flowchart LR\nA --> B"),
		).resolves.toEqual({
			svg: '<svg data-id="second">flowchart LR\nA --> B</svg>',
		});
		expect(loader).toHaveBeenCalledTimes(2);
	});
});
