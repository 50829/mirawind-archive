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
    ["relative-import", "NON_CANONICAL_IMPORT"],
    ["forbidden-edge", "FORBIDDEN_DEPENDENCY"],
    ["deep-import", "CROSS_MODULE_DEEP_IMPORT"],
    ["type-only", "FORBIDDEN_DEPENDENCY"],
    ["dynamic-import", "FORBIDDEN_DEPENDENCY"],
    ["cycle", "DEPENDENCY_CYCLE"],
    ["coupling", "DIRECT_INTERNAL_DEPENDENCY_LIMIT"],
    ["ports", "INJECTED_PORT_LIMIT"],
    ["alias-escape", "UNRESOLVED_INTERNAL_IMPORT"],
    ["entrypoint-adapter", "FORBIDDEN_DEPENDENCY"],
    ["long-cycle", "DEPENDENCY_CYCLE"],
  ])("rejects %s", async (fixture, code) => {
    const result = await analyzeDependencyGraph({
      sourceDirectory: resolve(fixtureRoot, fixture, "src"),
    });
    expect(result.diagnostics.map((item) => item.code)).toContain(code);
  });

  it("accepts the complete product source tree", async () => {
    const result = await analyzeDependencyGraph({
      sourceDirectory: productSource,
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.files.length).toBeGreaterThan(100);
  });
});
