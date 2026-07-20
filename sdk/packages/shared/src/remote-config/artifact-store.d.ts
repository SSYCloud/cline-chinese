import type {
	RemoteConfigBundle,
	RemoteConfigBundleStore,
	RemoteConfigManagedArtifactStore,
} from "./bundle";
export declare class FileRemoteConfigBundleStore
	implements RemoteConfigBundleStore
{
	private readonly filePath;
	constructor(filePath: string);
	read(): Promise<RemoteConfigBundle | undefined>;
	write(bundle: RemoteConfigBundle): Promise<void>;
	clear(): Promise<void>;
}
export declare class FileSystemRemoteConfigManagedArtifactStore
	implements RemoteConfigManagedArtifactStore
{
	writeText(filePath: string, contents: string): Promise<void>;
	remove(targetPath: string): Promise<void>;
	removeChildren(directoryPath: string): Promise<void>;
}
