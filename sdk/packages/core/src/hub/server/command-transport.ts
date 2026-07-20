import type {
	HubCommandEnvelope,
	HubEventEnvelope,
	HubReplyEnvelope,
} from "@coohu/shared";

export interface HubCommandTransport {
	command(envelope: HubCommandEnvelope): Promise<HubReplyEnvelope>;
	subscribe(
		clientId: string,
		listener: (event: HubEventEnvelope) => void,
		options?: { sessionId?: string },
	): Promise<() => void> | (() => void);
}
