import { describe, expect, it } from "vitest";
import { __test__ } from "./linear";

describe("linear binding lookup", () => {
	it("does not reuse a binding by participant key across different issue threads", () => {
		const result = __test__.findBindingForThread(
			{
				"linear:user:user_123": {
					channelId: "linear:issue:ISS-123",
					isDM: false,
					participantKey: "linear:user:user_123",
					participantLabel: "alice",
					serializedThread: "{}",
					sessionId: "sess-1",
					state: {
						sessionId: "sess-1",
						participantKey: "linear:user:user_123",
						participantLabel: "alice",
					},
					updatedAt: "2026-03-17T00:00:00.000Z",
				},
			},
			{
				id: "other_thread_id",
				channelId: "linear:issue:ISS-999",
				isDM: false,
				participantKey: "linear:user:user_123",
			},
		);

		expect(result).toBeUndefined();
	});
});
