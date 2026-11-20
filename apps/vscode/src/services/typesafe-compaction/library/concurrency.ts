export async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length)
	let next = 0
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const index = next++
			results[index] = await fn(items[index])
		}
	}
	const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker())
	await Promise.all(workers)
	return results
}
