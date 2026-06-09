import { formatDisplayUserInput } from "@coohu/shared/browser";

export function normalizeTitle(title?: string): string {
	if (!title?.trim()) return "";
	return formatDisplayUserInput(title);
}
