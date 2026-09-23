import { describe, expect, it } from "vitest"
import { formatBatchAmount } from "./batch-format"

describe("formatBatchAmount", () => {
	it.each([
		["4.0000000", "4"],
		["6.9900000", "6.99"],
		["0.0000000", "0"],
		["0.0000010", "0.000001"],
		["100.0100", "100.01"],
		["-4.5000", "-4.5"],
		["+4.5000", "+4.5"],
	])("removes only insignificant fractional zeroes from %s", (amount, expected) => {
		expect(formatBatchAmount(amount)).toBe(expected)
	})

	it.each([
		["9007199254740993.1234567890123456789000", "9007199254740993.1234567890123456789"],
		["0.0000000000000000000000000000010", "0.000000000000000000000000000001"],
		["0012.3400", "0012.34"],
	])("preserves every significant digit in %s", (amount, expected) => {
		expect(formatBatchAmount(amount)).toBe(expected)
	})

	it.each([
		"4",
		"100",
		"6.99",
		"",
		"unknown",
		"NaN",
		"Infinity",
		"1e-7",
		"4 CNY",
		" 4.0000 ",
		"1,000.00",
		"4.",
		".50",
	])("leaves unchanged or unrecognized amount %s intact", (amount) => {
		expect(formatBatchAmount(amount)).toBe(amount)
	})
})
