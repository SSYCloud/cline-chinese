import type { OpenTelemetryClientConfig } from "../services/telemetry";
import type { RemoteConfigBundle, RemoteConfigSyncContext, RemoteConfigTelemetryAdapter } from "./bundle";
import type { RemoteConfig } from "./schema";
export declare function resolveOpenTelemetryConfigFromRemoteConfig(remoteConfig: RemoteConfig | undefined): Partial<OpenTelemetryClientConfig> | undefined;
export declare function normalizeBundleTelemetry(telemetry: Record<string, unknown> | undefined): Partial<OpenTelemetryClientConfig> | undefined;
export declare class DefaultRemoteConfigTelemetryAdapter implements RemoteConfigTelemetryAdapter {
    name: string;
    resolveTelemetry(bundle: RemoteConfigBundle, _context: RemoteConfigSyncContext): Partial<OpenTelemetryClientConfig> | undefined;
}
