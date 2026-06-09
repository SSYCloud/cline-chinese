export declare function formatFileContentBlock(path: string, content: string): string;
export declare function formatUserInputBlock(input: string, mode?: "act" | "plan" | "yolo"): string;
export declare function formatUserCommandBlock(input: string, slash: string): string;
export type UserCommandEnvelope = {
    slash: string;
    content: string;
};
export declare function parseUserCommandEnvelope(input?: string): UserCommandEnvelope | undefined;
export declare function normalizeUserInput(input?: string): string;
export declare function formatDisplayUserInput(input?: string): string;
export declare function xmlTagsRemoval(input?: string, tag?: string): string;
