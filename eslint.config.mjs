// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default zotero({
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
