import type { ConnectCommandDefinition } from "./types";

type ConnectorRegistryEntry = {
	name: string;
	description: string;
	load: () => Promise<ConnectCommandDefinition>;
};

const registry = new Map<string, ConnectorRegistryEntry>([
	[
		"gchat",
		{
			name: "gchat",
			description: "基于 RPC 运行时会话的 Google Chat Webhook 网桥",
			load: async () => (await import("./adapters/gchat")).gchatConnector,
		},
	],
	[
		"linear",
		{
			name: "linear",
			description: "基于 RPC 运行时会话的 Linear Webhook 网桥",
			load: async () => (await import("./adapters/linear")).linearConnector,
		},
	],
	[
		"slack",
		{
			name: "slack",
			description: "基于 RPC 运行时会话的 Slack Webhook 网桥",
			load: async () => (await import("./adapters/slack")).slackConnector,
		},
	],
	[
		"telegram",
		{
			name: "telegram",
			description: "将 Telegram 机器人消息桥接到 RPC 聊天会话",
			load: async () => (await import("./adapters/telegram")).telegramConnector,
		},
	],
	[
		"whatsapp",
		{
			name: "whatsapp",
			description: "将 WhatsApp webhook 消息桥接到 RPC 聊天会话",
			load: async () => (await import("./adapters/whatsapp")).whatsappConnector,
		},
	],
]);

export function listConnectors(): Array<
	Pick<ConnectorRegistryEntry, "name" | "description">
> {
	return [...registry.values()].map(({ name, description }) => ({
		name,
		description,
	}));
}

export async function getConnector(
	name: string,
): Promise<ConnectCommandDefinition | undefined> {
	const entry = registry.get(name.trim().toLowerCase());
	return entry ? entry.load() : undefined;
}
