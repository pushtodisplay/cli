import { defineConfig, type Options } from "tsup";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const isProd = process.env.NODE_ENV === "production";

const pkg = JSON.parse(
  readFileSync(join(import.meta.dirname, "package.json"), "utf-8"),
) as { version: string };

// Create a shim file that provides `require` in ESM context
// so bundled CJS deps can require() node built-ins
const shimDir = join(import.meta.dirname, ".tsup");
if (!existsSync(shimDir)) mkdirSync(shimDir, { recursive: true });
writeFileSync(
  join(shimDir, "require-shim.js"),
  'import{createRequire}from"module";globalThis.require=createRequire(import.meta.url);',
);

const prodDefaults: Partial<Options> = {
  sourcemap: false,
  minify: "terser",
  terserOptions: {
    mangle: {
      toplevel: true,
    },
    compress: {
      drop_console: false, // keep console for CLI output
      passes: 2,
    },
  },
  noExternal: [/.*/], // bundle all deps into single file
  platform: "node",
};

const devDefaults: Partial<Options> = {
  sourcemap: true,
  minify: false,
};

const env = isProd ? prodDefaults : devDefaults;

const shimPath = join(import.meta.dirname, ".tsup", "require-shim.js");

export default defineConfig([
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
    outDir: "dist",
    define: { __PKG_VERSION__: JSON.stringify(pkg.version) },
    esbuildOptions: (options) => {
      options.inject = [shimPath];
    },
    ...env,
  },
  {
    entry: ["src/mcp-server.ts"],
    format: ["esm"],
    clean: false,
    outDir: "dist",
    esbuildOptions: (options) => {
      options.inject = [shimPath];
    },
    ...env,
  },
]);
