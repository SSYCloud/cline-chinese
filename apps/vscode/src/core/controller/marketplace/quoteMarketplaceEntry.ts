import type { MarketplaceEntryQuoteRequest, MarketplaceEntryQuoteResult } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { quoteMarketplaceEntryFromCatalog } from "./marketplace-helpers"

export async function quoteMarketplaceEntry(
	_controller: Controller,
	request: MarketplaceEntryQuoteRequest,
): Promise<MarketplaceEntryQuoteResult> {
	const inputRows = (request.inputRows ?? []).map((row) => row.fields ?? {})
	return quoteMarketplaceEntryFromCatalog(request.id, inputRows, request.listingVersionId)
}
