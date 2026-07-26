import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildZip } from "../../../scripts/fixtures/zip-builder";
import { createReferencePackFromArchive } from "../../../scripts/fixtures/create-mineru-reference-pack";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "reference-pack-test-"));
  roots.push(root);
  const archivePath = join(root, "book.zip");
  await writeFile(
    archivePath,
    buildZip({
      entries: [
        {
          data: "# Book\n\n## Contents\n\n## Chapter One .... 1\n\n## Chapter One\n\nBody.\n",
          name: "bundle/full.md",
        },
        { data: "%PDF synthetic", name: "bundle/origin.pdf" },
        {
          data: JSON.stringify([
            {
              page_idx: 2,
              text: "Contents",
              type: "text",
            },
          ]),
          name: "bundle/full_content_list.json",
        },
      ],
    }),
  );
  return { archivePath, root };
}

describe("MinerU reference review pack", () => {
  it("emits observations and rendered pages without expected decisions", async () => {
    const input = await fixture();
    const outputDirectory = join(input.root, "pack");
    const temporaryParent = join(input.root, "temporary");
    const result = await createReferencePackFromArchive({
      archivePath: input.archivePath,
      fixtureId: "real-mineru-a7f31c",
      outputDirectory,
      pageIndices: [0, 1, 2],
      pdfInspector: async () => 12,
      pdfRenderer: async ({ outputDirectory: pages }) => {
        await writeFile(join(pages, "page-0001.png"), "page one");
        await writeFile(join(pages, "page-0002.png"), "page two");
        await writeFile(join(pages, "page-0003.png"), "page three");
        return ["page-0001.png", "page-0002.png", "page-0003.png"];
      },
      temporaryParent,
    });

    expect(result).toMatchObject({
      fixture_id: "real-mineru-a7f31c",
      markdown_documents: [
        {
          headings: [
            { depth: 1, root_index: 0, text: "Book" },
            { depth: 2, root_index: 1, text: "Contents" },
            { depth: 2, root_index: 2, text: "Chapter One .... 1" },
            { depth: 2, root_index: 3, text: "Chapter One" },
          ],
          relative_path: "bundle/full.md",
        },
      ],
      pdf_documents: [
        {
          page_count: 12,
          rendered_pages: [
            { page_index: 0, relative_path: expect.any(String) },
            { page_index: 1, relative_path: expect.any(String) },
            { page_index: 2, relative_path: expect.any(String) },
          ],
          relative_path: "bundle/origin.pdf",
        },
      ],
      schema_version: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /canonical|display_level|starts_page|expected_match/u,
    );
    expect(
      JSON.parse(
        await readFile(join(outputDirectory, "observations.json"), "utf8"),
      ),
    ).toEqual(result);
    expect(await readdir(temporaryParent)).toEqual([]);
  });

  it("removes partial output and extraction workspace after failure", async () => {
    const input = await fixture();
    const outputDirectory = join(input.root, "failed-pack");
    const temporaryParent = join(input.root, "temporary");

    await expect(
      createReferencePackFromArchive({
        archivePath: input.archivePath,
        fixtureId: "real-mineru-a7f31c",
        outputDirectory,
        pdfInspector: async () => {
          throw new Error("invalid PDF");
        },
        temporaryParent,
      }),
    ).rejects.toThrow("invalid PDF");
    await expect(access(outputDirectory)).rejects.toThrow();
    expect(await readdir(temporaryParent)).toEqual([]);
  });

  it("does not import production contents or structure proposals", async () => {
    const source = await readFile(
      new URL(
        "../../../scripts/fixtures/create-mineru-reference-pack.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).not.toMatch(/printed-toc|structure-proposal|prepare-draft/u);
  });
});
