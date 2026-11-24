import { describe, it } from "mocha"
import "should"
import { findLast, findLastIndex } from "./array"

describe("Array Utilities", () => {
	describe("findLastIndex", () => {
		it("should find last matching element's index", () => {
			const array = [1, 2, 3, 2, 1]
			const index = findLastIndex(array, (x) => x === 2)
			index.should.equal(3) // last '2' is at index 3
		})

		it("should return -1 when no element matches", () => {
			const array = [1, 2, 3]
			const index = findLastIndex(array, (x) => x === 4)
			index.should.equal(-1)
		})

		it("should handle empty arrays", () => {
			const array: number[] = []
			const index = findLastIndex(array, (x) => x === 1)
			index.should.equal(-1)
		})

		it("should provide array reference in predicate", () => {
			const array = [1, 2, 3]
			findLastIndex(array, (_, __, arr) => {
				arr.should.equal(array) // Should pass original array
				return false
			})
		})
	})

	describe("findLast", () => {
		it("should return undefined when no element matches", () => {
			const array = [1, 2, 3]
			const element = findLast(array, (x) => x === 4)
			should(element).be.undefined()
		})

		it("should work with object arrays", () => {
			const array = [
				{ id: 1, value: "a" },
				{ id: 2, value: "b" },
				{ id: 3, value: "a" },
			]
			const element = findLast(array, (x) => x.value === "a")
			should(element).not.be.undefined()
			element!.should.deepEqual({ id: 3, value: "a" })
		})
	})
})
