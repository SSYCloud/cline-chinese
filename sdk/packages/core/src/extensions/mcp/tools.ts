import { type AgentTool, createTool } from "@cline/shared";
import { defaultMcpToolNameTransform } from "./name-transform";
import type { CreateMcpToolsOptions, McpToolDescriptor } from "./types";

function defaultMcpDescription(
	serverName: string,
	tool: McpToolDescriptor,
): string {
	const base = tool.description?.trim();
	if (base) {
		return base;
	}
	return `Execute MCP tool "${tool.name}" from server "${serverName}".`;
}

function isNullSchema(node: unknown): boolean {
	return (
		!!node &&
		typeof node === "object" &&
		(node as Record<string, unknown>).type === "null"
	);
}

/**
 * MCP servers (e.g. Python/pydantic) emit `Optional[T]` as
 * `anyOf: [T, {type: "null"}]` with no `type` on the property itself, which
 * Vertex/Gemini rejects. Collapse that shape to `T`; the property stays
 * optional because `required` is untouched.
 */
export function collapseNullableAnyOf(node: unknown): unknown {
	if (Array.isArray(node)) {
		return node.map(collapseNullableAnyOf);
	}
	if (!node || typeof node !== "object") {
		return node;
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node)) {
		result[key] = collapseNullableAnyOf(value);
	}
	for (const key of ["anyOf", "oneOf"]) {
		const variants = result[key];
		if (!Array.isArray(variants) || !variants.some(isNullSchema)) {
			continue;
		}
		const nonNull = variants.filter((variant) => !isNullSchema(variant));
		if (nonNull.length === 1 && nonNull[0] && typeof nonNull[0] === "object") {
			const { [key]: _removed, ...rest } = result;
			if (rest.default === null) {
				delete rest.default;
			}
			return { ...(nonNull[0] as Record<string, unknown>), ...rest };
		}
	}
	return result;
}

export async function createMcpTools(
	options: CreateMcpToolsOptions,
): Promise<AgentTool[]> {
	const descriptors = await options.provider.listTools(options.serverName);
	const nameTransform = options.nameTransform ?? defaultMcpToolNameTransform;

	return descriptors.map((descriptor) => {
		const agentToolName = nameTransform({
			serverName: options.serverName,
			toolName: descriptor.name,
		});

		return createTool({
			name: agentToolName,
			resultPolicy: "cache-oversized",
			description: defaultMcpDescription(options.serverName, descriptor),
			inputSchema: collapseNullableAnyOf(descriptor.inputSchema) as Record<
				string,
				unknown
			>,
			timeoutMs: options.timeoutMs,
			retryable: options.retryable,
			maxRetries: options.maxRetries,
			execute: async (input: unknown, context) =>
				options.provider.callTool({
					serverName: options.serverName,
					toolName: descriptor.name,
					arguments:
						input && typeof input === "object" && !Array.isArray(input)
							? (input as Record<string, unknown>)
							: undefined,
					context,
				}),
		});
	});
}
