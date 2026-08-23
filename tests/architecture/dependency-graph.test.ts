import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  analyzeDependencyGraph,
  type ArchitectureDiagnosticCode,
} from "../../scripts/architecture/dependency-graph.js";

const fixtureRoot = resolve(import.meta.dirname, "../fixtures/architecture");
const productSource = resolve(import.meta.dirname, "../../src");

describe("architecture dependency graph", () => {
  it.each<readonly [string, ArchitectureDiagnosticCode]>([
    ["local-alias", "NON_CANONICAL_IMPORT"],
    ["cross-package-relative", "NON_CANONICAL_IMPORT"],
    ["forbidden-edge", "FORBIDDEN_DEPENDENCY"],
    ["deep-import", "CROSS_MODULE_DEEP_IMPORT"],
    ["type-only", "FORBIDDEN_DEPENDENCY"],
    ["dynamic-import", "FORBIDDEN_DEPENDENCY"],
    ["cycle", "DEPENDENCY_CYCLE"],
    ["coupling", "DIRECT_INTERNAL_DEPENDENCY_LIMIT"],
    ["ports", "INJECTED_PORT_LIMIT"],
    ["alias-escape", "UNRESOLVED_INTERNAL_IMPORT"],
    ["entrypoint-adapter", "FORBIDDEN_DEPENDENCY"],
    ["core-runtime-io", "FORBIDDEN_DEPENDENCY"],
    ["long-cycle", "DEPENDENCY_CYCLE"],
    ["module-cycle", "MODULE_DEPENDENCY_CYCLE"],
    ["long-module-cycle", "MODULE_DEPENDENCY_CYCLE"],
    ["composition-business-sql", "COMPOSITION_BUSINESS_SQL"],
  ])("rejects %s", async (fixture, code) => {
    const result = await analyzeDependencyGraph({
      sourceDirectory: resolve(fixtureRoot, fixture, "src"),
    });
    expect(result.diagnostics.map((item) => item.code)).toContain(code);
  });

  it("accepts a relative import within one ownership package", async () => {
    const result = await analyzeDependencyGraph({
      sourceDirectory: resolve(fixtureRoot, "relative-import", "src"),
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts the complete product source tree", async () => {
    const result = await analyzeDependencyGraph({
      sourceDirectory: productSource,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.files.length).toBeGreaterThan(100);
  });
});
