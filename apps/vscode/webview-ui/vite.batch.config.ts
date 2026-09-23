import { resolve } from "node:path"
import { defineConfig, mergeConfig } from "vite"
import mainConfig from "./vite.config"

/** Independent lightweight entry for the native editor tab. Keep the sidebar's single-file build intact. */
export default mergeConfig(
	mainConfig,
	defineConfig({
		build: {
			outDir: "build",
			emptyOutDir: false,
			rollupOptions: {
				input: resolve(__dirname, "batch.html"),
				output: {
					inlineDynamicImports: false,
					entryFileNames: "assets/batch.js",
					chunkFileNames: "assets/batch-[name].js",
					assetFileNames: "assets/batch.[ext]",
				},
			},
		},
	}),
)
