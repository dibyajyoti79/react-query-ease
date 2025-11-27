import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  outDir: "dist",
  splitting: false,
  treeshake: true,
  outExtension({ format }) {
    return {
      js: format === "esm" ? ".esm.js" : ".js",
    };
  },
});
