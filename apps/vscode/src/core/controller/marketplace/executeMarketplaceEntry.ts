import type { MarketplaceEntryExecuteRequest, MarketplaceEntryExecuteResult } from "@shared/proto/cline/marketplace"
import type { Controller } from "../index"

export async function executeMarketplaceEntry(
	_controller: Controller,
	_request: MarketplaceEntryExecuteRequest,
): Promise<MarketplaceEntryExecuteResult> {
	throw new Error("旧版直接执行入口已停用。请在 Batch 对话中检查输入、获取预算并确认运行。")
}
