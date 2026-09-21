import type { MarketplaceRunResultArtifacts, MarketplaceRunResultArtifactsRequest } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { getMarketplaceRunResultArtifacts as runResultArtifacts } from "./marketplace-helpers"

export async function getMarketplaceRunResultArtifacts(
	_controller: Controller,
	request: MarketplaceRunResultArtifactsRequest,
): Promise<MarketplaceRunResultArtifacts> {
	return runResultArtifacts(request.runId)
}
