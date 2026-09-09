import { describe, it } from "bun:test"
import "should"
import { SSYError, SSYErrorType } from "../SSYError"

describe("SSYError", () => {
	describe("getErrorType", () => {
		it("should classify insufficient_quota as Balance", () => {
			const err = new SSYError({ message: "用户余额不足", code: "insufficient_quota" })
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.Balance)
		})

		it("should classify insufficient_credits with Chinese message as Balance", () => {
			const err = new SSYError({
				message:
					"insufficient balance: available balance: 0.0000, assets: 0.0000, gateway scoped voucher: 0.0000, credit limit: 0.0000, pending bill: 0.0000. Please recharge at: https://console.shengsuanyun.com/user/recharge",
				code: "insufficient_credits",
			})
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.Balance)
		})

		it("should classify 401 as Auth", () => {
			const err = new SSYError({ message: "Unauthorized", status: 401 })
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.Auth)
		})

		it("should classify invalid token as Auth", () => {
			const err = new SSYError({ message: "登录已过期", code: "INVALID_TOKEN" })
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.Auth)
		})

		it("should classify spend limit as SpendLimit", () => {
			const err = new SSYError({ message: "Spend limit reached", code: "SPEND_LIMIT_EXCEEDED", status: 429 })
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.SpendLimit)
		})

		it("should classify tpm limit as TpmLimitExceeded", () => {
			const err = new SSYError({ message: "Token per minute limit reached", code: "tpm_limit_exceeded" })
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.TpmLimitExceeded)
		})

		it("should classify rpm limit as RpmLimitExceeded", () => {
			const err = new SSYError({ message: "Request per minute limit reached", code: "rpm_limit_exceeded" })
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.RpmLimitExceeded)
		})

		it("should classify quota exceeded as QuotaExceeded", () => {
			const err = new SSYError({ message: "Inference quota exceeded", code: "quota_exceeded" })
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.QuotaExceeded)
		})

		it("should classify network errors as Network", () => {
			const err = new SSYError({ message: "Network error: socket hang up" })
			SSYError.getErrorType(err)!.should.equal(SSYErrorType.Network)
		})

		it("should default unknown errors to undefined", () => {
			const err = new SSYError({ message: "Something unrelated happened" })
			should.equal(SSYError.getErrorType(err), undefined)
		})
	})

	describe("serialize", () => {
		it("should keep providerId and request id", () => {
			const err = new SSYError({ message: "Unauthorized", status: 401, request_id: "req-123" }, "model-x", "shengsuanyun")
			const parsed = JSON.parse(err.serialize())
			parsed.providerId.should.equal("shengsuanyun")
			parsed.request_id.should.equal("req-123")
			parsed.status.should.equal(401)
		})
	})
})
