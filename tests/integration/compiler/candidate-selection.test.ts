import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { discoverMarkdownCandidates } from "@/compiler/document/candidate-discovery";

const fixtureRoot = fileURLToPath(
  new URL("../../fixtures/mineru/cases/", import.meta.url),
);
const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function temporaryFiles(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "candidate-discovery-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

describe("MinerU main-document candidate discovery", () => {
  it.each([
    ["cloud", "automatic", "cloud-high-confidence", "wrapper/result/full.md"],
    ["cli", "automatic", "cli-high-confidence", "exports/book/auto/book.md"],
    ["generic", "confirmation", "generic-single-markdown", "notes.md"],
  ] as const)(
    "selects the nested %s shape according to its evidence",
    async (name, decision, reason, path) => {
      let id = 0;
      const result = await discoverMarkdownCandidates(
        resolve(fixtureRoot, name),
        { idFactory: () => `cand_test_${++id}` },
      );

      expect(result).toMatchObject({
        decision,
        reason,
        selectedCandidateId: "cand_test_1",
      });
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]).toMatchObject({
        diagnostics: [],
        normalizedPath: path,
      });
    },
  );

  it("rejects same-bundle ambiguity and separate multi-book bundles", async () => {
    await expect(
      discoverMarkdownCandidates(resolve(fixtureRoot, "ambiguous")),
    ).resolves.toMatchObject({
      candidates: expect.arrayContaining([
        expect.objectContaining({ normalizedPath: "first.md" }),
        expect.objectContaining({ normalizedPath: "second.md" }),
      ]),
      decision: "reject",
      reason: "ambiguous-candidates",
      selectedCandidateId: null,
    });
    await expect(
      discoverMarkdownCandidates(resolve(fixtureRoot, "multi-book")),
    ).resolves.toMatchObject({
      decision: "reject",
      reason: "multiple-book-bundles",
      selectedCandidateId: null,
    });
  });

  it("rejects missing, remote, encoded traversal and cross-bundle resources", async () => {
    const root = await temporaryFiles({
      "book/full.md": [
        "# Book",
        "![missing](images/missing.png)",
        "![remote](https://example.test/image.png)",
        "![traversal](%2e%2e/other/secret.png)",
      ].join("\n"),
      "book/layout.json": "{}",
      "other/secret.png": "not reachable",
    });
    const result = await discoverMarkdownCandidates(root, {
      idFactory: () => "cand_missing_resources",
    });

    expect(result).toMatchObject({
      decision: "reject",
      reason: "missing-resources",
      selectedCandidateId: null,
    });
    expect(result.candidates[0]).toMatchObject({
      diagnostics: [{ code: "RESOURCE_MISSING_OR_UNSAFE", severity: "error" }],
      referencedResources: 3,
    });
  });

  it("ignores packaging metadata and rejects empty or absent final Markdown", async () => {
    const root = await temporaryFiles({
      "__MACOSX/ignored.md": "# Metadata",
      "book/README.md": "# Instructions",
      "book/empty.md": " \n",
      "book/images/placeholder.txt": "image stage",
      "book/middle.json": "{}",
    });
    await expect(discoverMarkdownCandidates(root)).resolves.toEqual({
      candidates: [],
      decision: "reject",
      reason: "no-markdown",
      selectedCandidateId: null,
    });
  });
});
