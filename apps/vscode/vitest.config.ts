import path from "node:path"
import { defineConfig } from "vitest/config"

// Vitest config for the VSCode extension's SDK-adapter and model-catalog
// unit tests. (The bulk of the extension's unit tests still run under mocha
// via `test:unit`; these suites are vitest-native.)
export default defineConfig({
	test: {
		include: [
			"src/sdk/**/*.test.ts",
			"src/shared/vsCodeSelectorUtils.test.ts",
			"src/shared/proto-conversions/models/**/*.test.ts",
			"src/core/storage/remote-config/**/*.test.ts",
			"src/core/controller/state/**/*.test.ts",
			"src/core/controller/slash/**/*.test.ts",
			"src/services/mcp/__tests__/settingsLock.test.ts",
			"src/shared/model-catalog/provider-helpers.test.ts",
			"src/core/controller/models/__tests__/providerCatalogHandlers.test.ts",
			"src/core/controller/models/__tests__/providerSwitchNormalization.test.ts",
			"src/core/controller/models/__tests__/resolveModelInfo.test.ts",
			"src/core/controller/models/__tests__/providerCatalogSmoke.test.ts",
			"src/core/controller/models/__tests__/refreshClineRecommendedModels.test.ts",
		],
		environment: "node",
		// Several suites lazily `await import()` their subject inside the first test
		// (needed so vi.mock factories apply first). That import pulls in heavy
		// workspace packages (@coohu/core/@coohu/llms/@coohu/shared), and on loaded
		// CI runners the first test in a file can blow past the 5s default and flake
		// (seen in catalog.test.ts and resolveModelInfo.test.ts). Raise the per-test
		// timeout so import cost attributed to the first test doesn't cause flakes.
		testTimeout: 20000,
		// Some matched files are intentionally-empty placeholders that point to
		// where the real suite lives (e.g. sdk-control-plane.test.ts), so an
		// empty file should not fail the run.
		passWithNoTests: true,
	},
	resolve: {
		alias: {
			"@coohu/core": path.resolve(__dirname, "src/test/cline-core-vitest-stub.ts"),
			"@coohu/llms": path.resolve(__dirname, "node_modules/@coohu/llms/dist/index.js"),
			// Map @coohu/shared subpath exports explicitly. The bare "@coohu/shared"
			// alias below does not cover subpaths (e.g. "@coohu/shared/storage"), and
			// Vite's fallback Node resolution does not read the package `exports` map
			// here, so subpath imports fail with "Cannot find package". Keep the more
			// specific subpath alias(es) before the bare package alias.
			"@coohu/shared/storage": path.resolve(__dirname, "node_modules/@coohu/shared/dist/storage/index.js"),
			"@coohu/shared": path.resolve(__dirname, "node_modules/@coohu/shared/dist/index.js"),
			vscode: path.resolve(__dirname, "src/test/vscode-vitest-stub.ts"),
			"@": path.resolve(__dirname, "src"),
			"@api": path.resolve(__dirname, "src/core/api"),
			"@core": path.resolve(__dirname, "src/core"),
			"@generated": path.resolve(__dirname, "src/generated"),
			"@hosts": path.resolve(__dirname, "src/hosts"),
			"@integrations": path.resolve(__dirname, "src/integrations"),
			"@services": path.resolve(__dirname, "src/services"),
			"@shared/proto/cline/common": path.resolve(__dirname, "src/shared/proto/cline/common.ts"),
			"@shared/proto/cline/models": path.resolve(__dirname, "src/shared/proto/cline/models.ts"),
			"@shared/proto": path.resolve(__dirname, "src/shared/proto"),
			"@shared": path.resolve(__dirname, "src/shared"),
			"@utils": path.resolve(__dirname, "src/utils"),
			"@packages": path.resolve(__dirname, "src/packages"),
		},
	},
})
