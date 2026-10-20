import { ShengSuanYunAuthError } from "@/sdk/shengsuanyun-account-service"
import type { Controller } from "../index"

export async function clearSsyAuthStateIfUnauthorized(controller: Controller, error: unknown): Promise<boolean> {
	if (!(error instanceof ShengSuanYunAuthError) || error.scope !== "session") {
		return false
	}
	controller.clearShengSuanYunAuthState()
	await controller.postStateToWebview()
	return true
}
