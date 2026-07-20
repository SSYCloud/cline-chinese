import { describe, it } from "bun:test"
import "should"
import { SSYError, SSYErrorType } from "../SSYError"

describe("SSYError", () => {
	describe("getErrorType", () => {
		it("should return QuotaExceeded when code is quota_exceeded", () => {
			const err = new SSYError({ message: "Quota exceeded", code: "quota_exceeded" })
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.QuotaExceeded)
		})

		it("should return Entitlement for the SDK ClinePass subscription message", () => {
			const err = new SSYError(
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://app.cline.bot/promo?code=CLI-8OFF&personal=true",
			)

			SSYError.getErrorType(err)!.should.equal(SSYErrorType.Entitlement)
		})

		it("should return Entitlement for the SDK ClinePass subscription message with a different app URL", () => {
			const err = new SSYError(
				"No access to ClinePass subscription models yet. Subscribe to ClinePass, the low cost open weights model coding plan: https://staging-app.cline.bot/promo?code=CLI-8OFF&personal=true",
			)

			SSYError.getErrorType(err)!.should.equal(SSYErrorType.Entitlement)
		})

		it("should return Entitlement for the raw required-plan message", () => {
			const err = new SSYError("403 Error 403: the user is not subscribed to required model plan")

			SSYError.getErrorType(err)!.should.equal(SSYErrorType.Entitlement)
		})

		it("should classify the SDK org individual subscription message separately", () => {
			const err = new SSYError(
				"Organization accounts cannot use ClinePass subscriptions. Go to /account -> change account to switch to your personal account for ClinePass",
			)

			SSYError.getErrorType(err)!.should.equal(SSYErrorType.OrgClinePassRestriction)
		})

		it("should classify the raw organization individual subscription message separately", () => {
			const err = new SSYError("403 Error 403: organization accounts cannot use individual model inference subscriptions")

			SSYError.getErrorType(err)!.should.equal(SSYErrorType.OrgClinePassRestriction)
		})
	})
})
