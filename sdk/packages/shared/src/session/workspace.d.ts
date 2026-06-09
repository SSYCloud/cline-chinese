import { z } from "zod";
export declare const WorkspaceInfoSchema: z.ZodObject<
	{
		rootPath: z.ZodString;
		hint: z.ZodOptional<z.ZodString>;
		associatedRemoteUrls: z.ZodOptional<z.ZodArray<z.ZodString>>;
		latestGitCommitHash: z.ZodOptional<z.ZodString>;
		latestGitBranchName: z.ZodOptional<z.ZodString>;
	},
	z.core.$strip
>;
export declare const WorkspaceManifestSchema: z.ZodObject<
	{
		currentWorkspacePath: z.ZodOptional<z.ZodString>;
		workspaces: z.ZodRecord<
			z.ZodString,
			z.ZodObject<
				{
					rootPath: z.ZodString;
					hint: z.ZodOptional<z.ZodString>;
					associatedRemoteUrls: z.ZodOptional<z.ZodArray<z.ZodString>>;
					latestGitCommitHash: z.ZodOptional<z.ZodString>;
					latestGitBranchName: z.ZodOptional<z.ZodString>;
				},
				z.core.$strip
			>
		>;
	},
	z.core.$strip
>;
export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;
export declare function emptyWorkspaceManifest(): WorkspaceManifest;
export interface WorkspaceInfo {
	rootPath: string;
	hint?: string;
	associatedRemoteUrls?: string[];
	latestGitCommitHash?: string;
	latestGitBranchName?: string;
}
export declare function upsertWorkspaceInfo(
	manifest: WorkspaceManifest,
	info: WorkspaceInfo,
): WorkspaceManifest;
