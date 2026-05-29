import type { AgentExtension, AgentHooks } from "@coohu/shared";

export function createAgentHooksExtension(
	name: string,
	hooks: AgentHooks | undefined,
): AgentExtension | undefined {
	if (!hooks) {
		return undefined;
	}
	return {
		name,
		manifest: { capabilities: ["hooks"] },
		hooks,
	};
}
