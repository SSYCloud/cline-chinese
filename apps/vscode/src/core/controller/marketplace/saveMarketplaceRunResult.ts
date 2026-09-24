import type { Empty } from "@shared/proto/cline/common"
import type { MarketplaceSaveRunResultRequest } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"

export async function saveMarketplaceRunResult(
	_controller: Controller,
	_request: MarketplaceSaveRunResultRequest,
): Promise<Empty> {
	throw new Error("批量结果由扩展端保存到原会话，不再另建 SDK 会话。")
}
