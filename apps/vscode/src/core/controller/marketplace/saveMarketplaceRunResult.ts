import { Empty } from "@shared/proto/cline/common"
import type { MarketplaceSaveRunResultRequest } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"

export async function saveMarketplaceRunResult(controller: Controller, request: MarketplaceSaveRunResultRequest): Promise<Empty> {
	await controller.saveMarketplaceRunResult({
		id: "",
		ts: Date.now(),
		task: [request.title, request.content].filter(Boolean).join("\n\n"),
		tokensIn: 0,
		tokensOut: 0,
		totalCost: 0,
	})
	return Empty.create({})
}
