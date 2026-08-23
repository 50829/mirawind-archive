import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  analyzeSemanticNames,
  inspectSemanticNames,
} from "../../scripts/architecture/semantic-names.js";

describe("semantic first-party names", () => {
  it("rejects historical versions and legacy distinctions in runtime names", () => {
    expect(
      inspectSemanticNames({
        path: "current-parser.ts",
        source: [
          "interface CurrentFormatV2 {}",
          "function parseCurrentV2(): void {}",
          "const legacyParser = 1;",
        ].join("\n"),
      }).map((item) => item.name),
    ).toEqual(["CurrentFormatV2", "parseCurrentV2", "legacyParser"]);
    expect(
      inspectSemanticNames({
        path: "current-v2.ts",
        source: 'export const identity = "current-format-v2";',
      }).map((item) => item.name),
    ).toContain("current-v2.ts");
  });

  it("does not treat strict version data or vendor filenames as runtime names", () => {
    expect(
      inspectSemanticNames({
        path: "current-format.ts",
        source: [
          'export const identity = "current-format-v2";',
          "export const schema_version = 2;",
          "export const vendorPattern = /content_list_v2\\.json/u;",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  it("accepts the complete product and fixture-tool source trees", async () => {
    const diagnostics = await analyzeSemanticNames({
      directories: [
        resolve(import.meta.dirname, "../../src"),
        resolve(import.meta.dirname, "../../scripts/fixtures"),
      ],
    });
    expect(diagnostics).toEqual([]);
  });
});
