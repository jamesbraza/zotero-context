import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    // Plugin bundle roots (esbuild entries in zotero-plugin.config.ts)
    "src/index.ts",
    "src/mcp-handler.ts",
    // Bundled and run inside Zotero by zotero-plugin-scaffold
    "test/**/*.test.ts",
    "zotero-plugin.config.ts",
  ],
  // addon/ holds static plugin assets loaded by Zotero itself, not imports
  project: ["src/**/*.ts", "test/**/*.ts"],
  ignoreDependencies: [
    // Tests use mocha's globals; scaffold copies node_modules/mocha/mocha.js
    // into the in-Zotero test runner
    "mocha",
    // Wired up via test/tsconfig.json "types", which knip does not read
    "@types/mocha",
  ],
};

export default config;
