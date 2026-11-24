import * as os from "node:os"
import { beforeEach, describe, it } from "mocha"
import "should"
import { _getFsInfoCacheSizeForTests, _resetFsInfoCacheForTests, getFsInfo } from "./fs-info"

describe("getFsInfo", () => {
	beforeEach(() => {
		_resetFsInfoCacheForTests()
	})

	it("returns the unknown sentinel for an empty path", async () => {
		const info = await getFsInfo("")
		info.fsClass.should.equal("unknown")
		info.fsType.should.equal("unknown")
	})

	// macOS/Linux only — Windows currently returns the unknown sentinel
	// unconditionally (see fs-info.ts: detection is unimplemented there).
	const detectPlatforms: NodeJS.Platform[] = ["darwin", "linux"]
	if (detectPlatforms.includes(process.platform)) {
		it("classifies the OS temp directory as a local filesystem", async () => {
			const info = await getFsInfo(os.tmpdir())
			// We don't assert on the exact fsType because it varies (apfs on
			// macOS, tmpfs/ext4 on Linux containers, etc.) — what we care
			// about is that it lands in the "local" bucket, not "network".
			info.fsClass.should.equal("local")
			info.fsType.should.not.equal("unknown")
		})

		it("caches results per path", async () => {
			const path = os.tmpdir()
			const a = await getFsInfo(path)
			const b = await getFsInfo(path)
			// Same reference proves the Map cache is being hit, not just
			// equal-by-value.
			a.should.equal(b)
		})

		it("caches successful results exactly once and skips the UNKNOWN sentinel", async () => {
			// undefined/empty short-circuit and do not touch the cache.
			await getFsInfo(undefined)
			await getFsInfo("")
			_getFsInfoCacheSizeForTests().should.equal(0)

			// A real path goes through detect() and stores one entry.
			await getFsInfo(os.tmpdir())
			_getFsInfoCacheSizeForTests().should.equal(1)
		})
	}
})
