import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("should have plugin instance defined", function () {
    // The plugin instance is attached at runtime, unknown to typeof Zotero
    assert.isNotEmpty(
      (Zotero as unknown as Record<string, unknown>)[config.addonInstance],
    );
  });
});
