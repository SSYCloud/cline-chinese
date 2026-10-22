import type { CloudSessionStatus } from "./cloud/cloud-sessions"

export type HistoryItem = {
	id: string
	ulid?: string // ULID for better tracking and metrics
	ts: number
	task: string
	tokensIn: number
	tokensOut: number
	cacheWrites?: number
	cacheReads?: number
	totalCost: number

	size?: number
	cwdOnTaskInitialization?: string
	conversationHistoryDeletedRange?: [number, number]
	isFavorited?: boolean

	modelId?: string
	/**
	 * Provider id the task ran on (from the SDK session record). Absent for
	 * tasks recorded before this field existed and for legacy imports —
	 * cost-display consumers treat an absent provider as "show", since
	 * there is nothing to key suppression on.
	 */
	apiProvider?: string
	isLegacy?: boolean
	/**
	 * Marks a batch-mode (LoomLoom) execution result. When true, the history
	 * list opens it on the Batch result page instead of loading it into
	 * Plan/Act chat.
	 */
	isBatchResult?: boolean

	/** "cloud" for Cline Cloud sessions; absent/"local" for tasks run in this workspace. */
	executionTarget?: "local" | "cloud"
	cloudStatus?: CloudSessionStatus
	cloudRepoUrl?: string
	cloudBranch?: string
	/** True when cloud usage came from an authoritative remote runtime snapshot. */
	cloudUsageAvailable?: boolean
}
