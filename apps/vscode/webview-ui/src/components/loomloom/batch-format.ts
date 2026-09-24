/** Format a decimal amount for display without converting or rounding its value. */
export function formatBatchAmount(amount: string): string {
	if (!/^[+-]?\d+\.\d+$/.test(amount)) return amount

	return amount.replace(/0+$/, "").replace(/\.$/, "")
}
