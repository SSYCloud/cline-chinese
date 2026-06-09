import type { RemoteConfigManagedPaths } from "./bundle";
export declare const DEFAULT_REMOTE_CONFIG_PLUGIN_NAME = "remote-config";
export declare function resolveRemoteConfigPaths(input: {
	workspacePath: string;
	pluginName?: string;
}): RemoteConfigManagedPaths;
export declare function getRemoteConfigCommandDirectories(
	paths: RemoteConfigManagedPaths,
): {
	workflowsDirectories: readonly string[];
	skillsDirectories: readonly string[];
};
