import { SubmitLimitIncreaseResponse } from "@shared/proto/cline/account";
import type { EmptyRequest } from "@shared/proto/cline/common";
import type { Controller } from "../index";

/**
 * Submits a spend limit increase request to the user's org admin.
 * Called when the user clicks "Request Increase" on the SpendLimitError component.
 * @param controller The controller instance
 * @param _request Empty request
 * @returns SubmitLimitIncreaseResponse indicating success or failure
 */
export async function submitLimitIncreaseRequest(
	_controller: Controller,
	_request: EmptyRequest,
): Promise<SubmitLimitIncreaseResponse> {
	return SubmitLimitIncreaseResponse.create({ success: false });
}
