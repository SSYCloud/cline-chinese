import { describe, expect, it } from "vitest";
import { __test__ } from "./whatsapp";

describe("whatsapp binding lookup", () => {
	it("does not reuse a binding by participant key across different threads", () => {
		const result = __test__.findBindingForThread(
			{
				"whatsapp:user:15551234567": {
					channelId: "phone-123",
					isDM: true,
					participantKey: "whatsapp:user:15551234567",
					participantLabel: "Alice",
					serializedThread: "{}",
					sessionId: "sess-1",
					state: {
						sessionId: "sess-1",
						participantKey: "whatsapp:user:15551234567",
						participantLabel: "Alice",
					},
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "other_thread_id",
				channelId: "phone-999",
				isDM: true,
				participantKey: "whatsapp:user:15551234567",
			},
		);

		expect(result).toBeUndefined();
	});
});
