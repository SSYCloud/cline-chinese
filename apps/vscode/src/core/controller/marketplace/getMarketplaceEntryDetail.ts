import type { MarketplaceEntryDetail, MarketplaceEntryDetailRequest } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"
import { fetchMarketplaceEntryDetail } from "./marketplace-helpers"

export async function getMarketplaceEntryDetail(
	_controller: Controller,
	request: MarketplaceEntryDetailRequest,
): Promise<MarketplaceEntryDetail> {
	return fetchMarketplaceEntryDetail(request.id)
}
