import type { AgentExtension } from "../agents/types";
import type { PreparedRemoteConfigRuntime, PrepareRemoteConfigRuntimeOptions, RemoteConfigBundle, RemoteConfigProjectContext, RemoteConfigSyncResult, RemoteConfigSyncServiceOptions } from "./bundle";
export declare function withRemoteConfigBundlePaths<T extends RemoteConfigBundle>(bundle: T, paths: RemoteConfigSyncResult["materialized"]["paths"]): T;
export declare class RemoteConfigSyncService {
    private readonly options;
    constructor(options: RemoteConfigSyncServiceOptions);
    sync(input: {
        workspacePath: string;
        rootPath?: string;
        context?: RemoteConfigProjectContext;
        paths: RemoteConfigSyncResult["materialized"]["paths"];
        signal?: AbortSignal;
        now?: number;
    }): Promise<RemoteConfigSyncResult>;
}
export declare function createRemoteConfigPluginDefinition(options?: {
    name?: string;
    setup?: AgentExtension["setup"];
}): AgentExtension;
export declare function prepareRemoteConfigRuntime(options: PrepareRemoteConfigRuntimeOptions): Promise<PreparedRemoteConfigRuntime>;
