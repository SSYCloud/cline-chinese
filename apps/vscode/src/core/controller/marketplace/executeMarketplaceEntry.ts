import type { MarketplaceEntryExecuteRequest, MarketplaceEntryExecuteResult } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { executeMarketplaceEntryFromCatalog } from "./marketplace-helpers"

export async function executeMarketplaceEntry(
	_controller: Controller,
	request: MarketplaceEntryExecuteRequest,
): Promise<MarketplaceEntryExecuteResult> {
	const inputRows = (request.inputRows ?? []).map((row) => row.fields ?? {})
	return executeMarketplaceEntryFromCatalog(request.id, inputRows, request.confirm, request.clientRequestId)
}
