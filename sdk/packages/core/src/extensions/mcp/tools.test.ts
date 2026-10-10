import { describe, expect, it } from "vitest";
import { createMcpTools } from "./tools";

describe("MCP result policy", () => {
	it("opts in independently of naming and preserves the provider response", async () => {
		const output = { content: [{ type: "text", text: "original" }] };
		const tools = await createMcpTools({
			serverName: "github",
			nameTransform: () => "custom_name",
			provider: {
				listTools: async () => [
					{ name: "get_diff", inputSchema: { type: "object" } },
				],
				callTool: async () => output,
			},
		});
		expect(tools[0].resultPolicy).toBe("cache-oversized");
		expect(await tools[0].execute({}, { agentId: "agent", iteration: 1 })).toBe(
			output,
		);
	});
});

describe("MCP input schema normalization", () => {
	it("collapses nullable anyOf so every property keeps a type", async () => {
		const tools = await createMcpTools({
			serverName: "artemis",
			provider: {
				listTools: async () => [
					{
						name: "mobile_get_device_state",
						inputSchema: {
							type: "object",
							properties: {
								view_type: { type: "string", title: "View Type" },
								device_serial: {
									anyOf: [{ type: "string" }, { type: "null" }],
									default: null,
									title: "Device Serial",
								},
								steps: {
									anyOf: [
										{ type: "array", items: { type: "integer" } },
										{ type: "null" },
									],
								},
								either: { anyOf: [{ type: "string" }, { type: "integer" }] },
							},
							required: ["view_type"],
						},
					},
				],
				callTool: async () => ({}),
			},
		});
		const properties = (
			tools[0].inputSchema as { properties: Record<string, unknown> }
		).properties;
		expect(properties.device_serial).toEqual({
			type: "string",
			title: "Device Serial",
		});
		expect(properties.steps).toEqual({
			type: "array",
			items: { type: "integer" },
		});
		expect(properties.either).toEqual({
			anyOf: [{ type: "string" }, { type: "integer" }],
		});
		expect((tools[0].inputSchema as { required: string[] }).required).toEqual([
			"view_type",
		]);
	});
});
