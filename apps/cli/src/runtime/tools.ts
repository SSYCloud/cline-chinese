import {
	type BuiltinToolAvailabilityContext,
	getCoreBuiltinToolCatalog,
	resolveDisabledToolNames,
	type ToolCatalogEntry,
} from "@coohu/core";

export type { ToolCatalogEntry } from "@coohu/core";

export function getToolCatalog(
	availabilityContext?: BuiltinToolAvailabilityContext,
): ToolCatalogEntry[] {
	return getCoreBuiltinToolCatalog({
		disabledToolIds: resolveDisabledToolNames(),
		...availabilityContext,
	});
}
