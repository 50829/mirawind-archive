import { access, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const fixtureRoot = fileURLToPath(
  new URL("../../fixtures/mineru/", import.meta.url),
);

interface FixtureRegistry {
  readonly fixtures: readonly {
    readonly expected: {
      readonly candidate: string | null;
      readonly decision: "automatic" | "confirmation" | "reject";
      readonly reason: string;
    };
    readonly id: string;
    readonly kind: string;
    readonly root: string;
  }[];
  readonly schema_version: number;
}

async function markdownCount(path: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) count += await markdownCount(child);
    else if (entry.isFile() && entry.name.endsWith(".md")) count += 1;
  }
  return count;
}

describe("synthetic MinerU fixture registry", () => {
  it("registers all five minimized candidate-selection shapes", async () => {
    const registry = JSON.parse(
      await readFile(resolve(fixtureRoot, "fixtures.json"), "utf8"),
    ) as FixtureRegistry;

    expect(registry.schema_version).toBe(1);
    expect(registry.fixtures.map((fixture) => fixture.kind)).toEqual([
      "cloud",
      "cli",
      "generic",
      "ambiguous",
      "multi-book",
    ]);
    for (const fixture of registry.fixtures) {
      const root = resolve(fixtureRoot, fixture.root);
      await access(root);
      const count = await markdownCount(root);
      expect(count).toBe(
        fixture.kind === "ambiguous" || fixture.kind === "multi-book" ? 2 : 1,
      );
      if (fixture.expected.candidate) {
        await access(resolve(root, fixture.expected.candidate));
      }
    }
  });
});
