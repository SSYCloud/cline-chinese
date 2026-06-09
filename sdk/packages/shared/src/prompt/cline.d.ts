import type { WorkspaceContext } from "../extensions/context";
import type { WorkspaceInfo } from "../session/workspace";
export declare function processWorkspaceInfo(info: WorkspaceInfo): string;
/**
 * Options for building the Cline system prompt.
 *
 * Extends WorkspaceContext so callers can spread an ExtensionContext.workspace
 * directly. `workspaceRoot` is accepted as an alias for `rootPath` to support
 * existing call sites that set it explicitly.
 */
export interface ClineSystemPromptOptions extends Omit<WorkspaceContext, "rootPath"> {
    /**
     * Workspace root path. Accepts either `rootPath` (from WorkspaceContext/WorkspaceInfo)
     * or `workspaceRoot` (legacy alias) — whichever is provided will be used.
     */
    rootPath?: string;
    /** Alias for rootPath — kept for backwards compatibility with existing call sites */
    workspaceRoot?: string;
    /** Per-request system prompt override */
    overridePrompt?: string;
    /** Provider ID — used to gate Cline-specific metadata injection */
    providerId?: string;
}
export declare function buildClineSystemPrompt(options: ClineSystemPromptOptions): string;
