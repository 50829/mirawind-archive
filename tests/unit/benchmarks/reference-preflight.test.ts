import { describe, expect, it } from "vitest";

import {
  assertReferencePreflight,
  type ReferenceFixtureBinding,
} from "../../../scripts/benchmarks/reference-preflight.js";

function bindings(count = 15): readonly ReferenceFixtureBinding[] {
  return Array.from({ length: count }, (_, index) => ({
    fixture_id: `real-mineru-${String(index + 1).padStart(12, "0")}`,
    reference_schema_version: 3,
    reference_sha256: index.toString(16).padStart(64, "0"),
    zip_sha256: (index + 100).toString(16).padStart(64, "0"),
  }));
}

describe("fifteen-book reference preflight", () => {
  it("accepts exactly fifteen unique hash-bound v2 references", () => {
    expect(assertReferencePreflight(bindings())).toHaveLength(15);
  });

  it("rejects incomplete, duplicate and unsupported references", () => {
    expect(() => assertReferencePreflight(bindings(14))).toThrow(
      "REFERENCE_PREFLIGHT_COUNT_INVALID",
    );
    const duplicate = [...bindings()];
    const first = duplicate[0];
    if (!first) throw new Error("test binding missing");
    duplicate[14] = first;
    expect(() => assertReferencePreflight(duplicate)).toThrow(
      "REFERENCE_PREFLIGHT_DUPLICATE",
    );
    const old = [...bindings()];
    old[0] = { ...first, reference_schema_version: 1 as 3 };
    expect(() => assertReferencePreflight(old)).toThrow(
      "REFERENCE_PREFLIGHT_SCHEMA_INVALID",
    );
  });
});
