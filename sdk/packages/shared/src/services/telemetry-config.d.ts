import type { OpenTelemetryClientConfig, TelemetryMetadata } from "./telemetry";
export interface ClineTelemetryServiceConfig extends OpenTelemetryClientConfig {
    metadata: TelemetryMetadata;
}
export declare function createClineTelemetryServiceMetadata(overrides?: Partial<TelemetryMetadata>): TelemetryMetadata;
export declare function createClineTelemetryServiceConfig(configOverrides?: Partial<ClineTelemetryServiceConfig>): ClineTelemetryServiceConfig;
