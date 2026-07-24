// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";
import tseslint from "typescript-eslint";

const zoteroConfig = zotero({
  overrides: [
    {
      // Grabs are ephemeral by design: no annotations created, no library
      // writes (specs: grab-mode/area-grab; tasks.md 4.2). This turns the
      // manual grep-verification into a regression guard.
      files: ["src/**/*.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            // Zotero-specific write APIs only — bare save()/erase() would
            // also match benign methods like CanvasRenderingContext2D.save()
            selector:
              "CallExpression[callee.property.name=/^(saveTx|eraseTx|addAnnotation|saveAnnotations|saveFromJSON|createAnnotation)$/]",
            message:
              "Grabs are ephemeral: no annotation creation or library writes.",
          },
        ],
      },
    },
    {
      // src/core is viewer-agnostic: no Zotero globals or plugin imports,
      // so it can be reused by the browser-extension sibling (see design.md).
      files: ["src/core/**/*.ts"],
      rules: {
        "no-restricted-globals": [
          "error",
          "Zotero",
          "ZoteroPane",
          "Zotero_Tabs",
          "ztoolkit",
          "addon",
          "rootURI",
          "Components",
          "Services",
        ],
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "zotero-plugin-toolkit",
                  "**/adapter/*",
                  "**/modules/*",
                  "**/utils/*",
                ],
                message:
                  "src/core must stay viewer-agnostic (no Zotero or shell imports).",
              },
            ],
          },
        ],
      },
    },
  ],
});

export default tseslint.config(
  ...zoteroConfig,
  {
    // Type-aware linting on top of the zotero config's non-type-aware
    // typescript-eslint recommended
    files: ["src/**/*.ts", "test/**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // House style: invariant-backed `!` with a one-line justification
      "@typescript-eslint/no-non-null-assertion": "off",
      // zotero-types is optimistic — e.g. Items.get and getByTabID omit
      // their false/undefined returns (see
      // https://github.com/windingwind/zotero-types/issues/94) — so
      // "unnecessary" defensive conditions are frequently load-bearing here
      "@typescript-eslint/no-unnecessary-condition": "off",
      // Numbers and booleans stringify unambiguously
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      // Single legit use: unregistering the plugin instance on shutdown
      "@typescript-eslint/no-dynamic-delete": "off",
    },
  },
  {
    // src/adapter reaches into Zotero reader internals that are untyped by
    // design (private APIs, see adapter-smoke tests) — the unsafe-* family
    // would demand disables on nearly every line there
    files: ["src/adapter/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
