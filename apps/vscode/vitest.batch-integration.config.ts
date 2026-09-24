import path from "node:path"
import { defineConfig } from "vitest/config"

// Deliberately NOT the extension unit-test configuration: that aliases @cline/core
// to a stub and cannot prove what the real Agent runtime sends to a model.
export default defineConfig({
	test: { include: ["src/services/loomloom/*.integration.ts"], environment: "node", testTimeout: 20000 },
	resolve: {
		alias: {
			"@cline/core": path.resolve(__dirname, "node_modules/@cline/core/dist/index.js"),
			"@cline/shared/storage": path.resolve(__dirname, "node_modules/@cline/shared/dist/storage/index.js"),
			"@cline/shared/db": path.resolve(__dirname, "node_modules/@cline/shared/dist/db/index.js"),
			"@cline/shared/types": path.resolve(__dirname, "node_modules/@cline/shared/dist/types/index.js"),
			"@cline/shared/automation": path.resolve(__dirname, "node_modules/@cline/shared/dist/automation/index.js"),
			"@cline/shared/remote-config": path.resolve(__dirname, "node_modules/@cline/shared/dist/remote-config/index.js"),
			"@cline/shared/browser": path.resolve(__dirname, "node_modules/@cline/shared/dist/index.browser.js"),
			"@cline/shared/node": path.resolve(__dirname, "node_modules/@cline/shared/dist/node.js"),
			"@cline/shared": path.resolve(__dirname, "node_modules/@cline/shared/dist/index.js"),
			"@shared": path.resolve(__dirname, "src/shared"),
			"@": path.resolve(__dirname, "src"),
		},
	},
})
