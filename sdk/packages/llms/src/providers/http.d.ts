import type { GatewayProviderSettings } from "@coohu/shared";
export declare function ensureFetch(fetchImpl?: typeof fetch): typeof fetch;
export declare function resolveApiKey(settings: GatewayProviderSettings): Promise<string | undefined>;
export declare function fetchJson(url: string, init: RequestInit, options: {
    fetch: typeof fetch;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<unknown>;
export declare function compactObject<T extends Record<string, unknown>>(value: T): T;
