export const DEFAULT_REQUEST_HEADERS: Record<string, string> = {
	"HTTP-Referer": "vscode://HybridTalentComputing.cline-shengsuan/ssy",
	"X-Title": "cline-chinese",
};

export function serializeAbortReason(reason: unknown): unknown {
	return reason instanceof Error
		? { name: reason.name, message: reason.message }
		: reason;
}
