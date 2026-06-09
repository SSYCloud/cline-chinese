import type { PromptUploading, RemoteConfig } from "./schema";
export interface RemoteConfigBlobStoreSettings {
    bucket: string;
    adapterType: "s3" | "r2" | "azure";
    accessKeyId: string;
    secretAccessKey: string;
    region?: string;
    endpoint?: string;
    accountId?: string;
}
export interface RemoteConfigBlobStoreTarget {
    bucket: string;
    adapterType: "s3" | "r2" | "azure";
    region?: string;
    endpoint?: string;
    accountId?: string;
}
export interface RemoteConfigBlobStorageAdapter {
    write(path: string, value: string): Promise<void>;
}
export interface RemoteConfigSessionBlobUploadMetadata {
    version: 1;
    storage: RemoteConfigBlobStoreTarget;
    keyPrefix?: string;
    userDistinctId?: string;
}
export interface RemoteConfigSessionMetadataRow {
    metadata?: Record<string, unknown> | null;
}
export interface RemoteConfigSessionMessagesUploadInput {
    sessionId: string;
    path: string;
    contents: string;
    row?: RemoteConfigSessionMetadataRow;
}
export interface RemoteConfigSessionMessagesArtifactUploader {
    uploadMessagesFile(input: RemoteConfigSessionMessagesUploadInput): Promise<void>;
}
export declare const REMOTE_CONFIG_SESSION_BLOB_UPLOAD_METADATA_KEY = "enterprise.blobUpload";
export declare function resolveBlobStoreSettingsFromPromptUploading(promptUploading: PromptUploading | undefined): RemoteConfigBlobStoreSettings | undefined;
export declare function resolveBlobStoreSettingsFromRemoteConfig(remoteConfig: RemoteConfig | undefined): RemoteConfigBlobStoreSettings | undefined;
export declare function buildRemoteConfigSessionBlobUploadMetadata(remoteConfig: RemoteConfig | undefined, userDistinctId?: string): RemoteConfigSessionBlobUploadMetadata | undefined;
export declare function registerRemoteConfigSessionBlobUpload(sessionId: string, remoteConfig: RemoteConfig | undefined, userDistinctId?: string): RemoteConfigSessionBlobUploadMetadata | undefined;
export declare function clearRemoteConfigSessionBlobUpload(sessionId: string): void;
export declare function createRemoteConfigBlobStorageAdapter(settings: RemoteConfigBlobStoreSettings): RemoteConfigBlobStorageAdapter | undefined;
export declare function readRemoteConfigSessionBlobUploadMetadata(row: RemoteConfigSessionMetadataRow | undefined): RemoteConfigSessionBlobUploadMetadata | undefined;
export declare function createRemoteConfigSessionMessagesArtifactUploader(): RemoteConfigSessionMessagesArtifactUploader;
