import type { RemoteConfigMaterializationInput, RemoteConfigMaterializationResult, RemoteConfigPolicyMaterializer } from "./bundle";
export declare class FileSystemRemoteConfigPolicyMaterializer implements RemoteConfigPolicyMaterializer {
    materialize(input: RemoteConfigMaterializationInput): Promise<RemoteConfigMaterializationResult>;
}
