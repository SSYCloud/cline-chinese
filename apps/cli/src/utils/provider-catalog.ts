import {
	listLocalProviders as internalListLocalProviders,
	type ProviderSettingsManager,
} from "@coohu/core";
import { getCliFeatureFlagsService } from "./feature-flags";

export async function listLocalProviders(
	manager: ProviderSettingsManager,
): ReturnType<typeof internalListLocalProviders> {
	return await internalListLocalProviders(manager, {
		isClinePassEnabled:
			getCliFeatureFlagsService().getBooleanFlagEnabled("ext-cline-pass"),
	});
}
