export declare function hasLangfuseTelemetryConfig(): boolean;
export declare function ensureLangfuseTelemetry(_providerId: string): Promise<boolean>;
export declare function disposeLangfuseTelemetry(): Promise<void>;
export declare function debugLangfuse(message: string): void;
export declare function resetLangfuseTelemetryForTests(): void;
