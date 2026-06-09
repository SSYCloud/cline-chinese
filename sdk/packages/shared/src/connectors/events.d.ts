import { z } from "zod";
export declare const ConnectorHookEventNameSchema: z.ZodEnum<{
    "connector.started": "connector.started";
    "connector.stopping": "connector.stopping";
    "session.authorize": "session.authorize";
    "message.received": "message.received";
    "message.denied": "message.denied";
    "message.completed": "message.completed";
    "message.failed": "message.failed";
    "session.started": "session.started";
    "session.reused": "session.reused";
    "session.reset": "session.reset";
    "schedule.delivery.started": "schedule.delivery.started";
    "schedule.delivery.sent": "schedule.delivery.sent";
    "schedule.delivery.failed": "schedule.delivery.failed";
}>;
export type ConnectorHookEventName = z.infer<typeof ConnectorHookEventNameSchema>;
export declare const ConnectorEventActorSchema: z.ZodObject<{
    id: z.ZodOptional<z.ZodString>;
    label: z.ZodOptional<z.ZodString>;
    role: z.ZodOptional<z.ZodString>;
    participantKey: z.ZodOptional<z.ZodString>;
    participantLabel: z.ZodOptional<z.ZodString>;
    platformUserId: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const ConnectorEventContextSchema: z.ZodObject<{
    source: z.ZodString;
    sourceEvent: z.ZodString;
    threadId: z.ZodString;
    channelId: z.ZodString;
    isDM: z.ZodBoolean;
    sessionId: z.ZodOptional<z.ZodString>;
    workspaceRoot: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const ConnectorAuthorizationRequestSchema: z.ZodObject<{
    actor: z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        label: z.ZodOptional<z.ZodString>;
        role: z.ZodOptional<z.ZodString>;
        participantKey: z.ZodOptional<z.ZodString>;
        participantLabel: z.ZodOptional<z.ZodString>;
        platformUserId: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>;
    context: z.ZodObject<{
        source: z.ZodString;
        sourceEvent: z.ZodString;
        threadId: z.ZodString;
        channelId: z.ZodString;
        isDM: z.ZodBoolean;
        sessionId: z.ZodOptional<z.ZodString>;
        workspaceRoot: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>;
    payload: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const ConnectorAuthorizationDecisionSchema: z.ZodObject<{
    action: z.ZodDefault<z.ZodEnum<{
        allow: "allow";
        deny: "deny";
    }>>;
    message: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export declare const ConnectorHookEventSchema: z.ZodObject<{
    adapter: z.ZodString;
    botUserName: z.ZodOptional<z.ZodString>;
    event: z.ZodEnum<{
        "connector.started": "connector.started";
        "connector.stopping": "connector.stopping";
        "session.authorize": "session.authorize";
        "message.received": "message.received";
        "message.denied": "message.denied";
        "message.completed": "message.completed";
        "message.failed": "message.failed";
        "session.started": "session.started";
        "session.reused": "session.reused";
        "session.reset": "session.reset";
        "schedule.delivery.started": "schedule.delivery.started";
        "schedule.delivery.sent": "schedule.delivery.sent";
        "schedule.delivery.failed": "schedule.delivery.failed";
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    ts: z.ZodString;
}, z.core.$strip>;
export type ConnectorHookEvent = z.infer<typeof ConnectorHookEventSchema>;
export type ConnectorEventActor = z.infer<typeof ConnectorEventActorSchema>;
export type ConnectorEventContext = z.infer<typeof ConnectorEventContextSchema>;
export type ConnectorAuthorizationRequest = z.infer<typeof ConnectorAuthorizationRequestSchema>;
export type ConnectorAuthorizationDecision = z.infer<typeof ConnectorAuthorizationDecisionSchema>;
