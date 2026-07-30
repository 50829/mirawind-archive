import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import type { MarkdownCandidate } from "@/modules/publishing/adapters/filesystem/discover-markdown-candidates";
import {
  parsePrintedContentsAnalysisV2,
  printedContentsAnalysisIdentity,
} from "@/modules/publishing/core/preparation/printed-contents-analysis";
import { readPdfContentsEvidence } from "@/modules/publishing/adapters/filesystem/read-pdf-contents-evidence";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { analyzeImport } from "@/modules/publishing/adapters/worker/analyze-import";
import { finalizePreparedDraft } from "@/modules/publishing/adapters/worker/finalize-prepared-draft";
import { prepareDraft } from "@/modules/publishing/adapters/worker/prepare-draft";
import { parseBookConfigYaml } from "@/modules/publishing/core/publication/book-config-schema";
import { buildZip } from "../../../scripts/fixtures/zip-builder";
import { withMigratedTestDatabase } from "../../helpers/database.js";

const sha256 = "a".repeat(64);
const printedTocFixturePath = fileURLToPath(
  new URL("../../fixtures/publishing-quality/printed-toc.md", import.meta.url),
);

function candidate(): MarkdownCandidate {
  return Object.freeze({
    byteSize: 100,
    companionFiles: Object.freeze(["layout.json"]),
    confidence: "high",
    diagnostics: Object.freeze([]),
    firstHeading: "Prepared Book",
    id: "cand_abcdefghijklmnop",
    normalizedPath: "wrapper/full.md",
    referencedResources: 1,
    score: 100,
  });
}

describe("prepare_draft candidate handoff", () => {
  it("claims the validated analysis extraction without reopening the archive", async () => {
    const dataRoot = await import("../../helpers/data-root.js").then(
      ({ createTemporaryDataRoot }) =>
        createTemporaryDataRoot("prepare-sealed-extraction"),
    );
    try {
      const importId = "imp_sealed_extract_0001";
      const archivePath = resolve(dataRoot.path, "input.zip");
      const sealedExtractionDirectory = resolve(
        dataRoot.layout.uploadDirectory,
        importId,
        "sealed-extraction",
      );
      await writeFile(
        archivePath,
        buildZip({
          entries: [{ data: "# Book\n\nBody.\n", name: "wrapper/full.md" }],
        }),
      );
      await analyzeImport({
        archivePath,
        importId,
        sealedExtractionDirectory,
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_analyze_sealed_0001",
        ),
      });
      await rm(archivePath);

      const prepared = await prepareDraft({
        archivePath,
        importId,
        sealedExtractionDirectory,
        selectedCandidatePath: "wrapper/full.md",
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_prepare_sealed_0001",
        ),
      });

      expect(prepared.extractionSource).toBe("sealed");
      await expect(access(sealedExtractionDirectory)).rejects.toThrow();
      await expect(
        access(resolve(prepared.extractedRoot, "wrapper/full.md")),
      ).resolves.toBeUndefined();
    } finally {
      await dataRoot.cleanup();
    }
  });

  it("discards an invalid sealed marker and falls back to safe extraction", async () => {
    const dataRoot = await import("../../helpers/data-root.js").then(
      ({ createTemporaryDataRoot }) =>
        createTemporaryDataRoot("prepare-invalid-sealed-extraction"),
    );
    try {
      const importId = "imp_invalid_sealed_0001";
      const archivePath = resolve(dataRoot.path, "input.zip");
      const sealedExtractionDirectory = resolve(
        dataRoot.layout.uploadDirectory,
        importId,
        "sealed-extraction",
      );
      await writeFile(
        archivePath,
        buildZip({
          entries: [
            { data: "# Archive Book\n\nBody.\n", name: "wrapper/full.md" },
          ],
        }),
      );
      await mkdir(resolve(sealedExtractionDirectory, "tree/wrapper"), {
        recursive: true,
      });
      await writeFile(
        resolve(sealedExtractionDirectory, "marker.json"),
        `${JSON.stringify({
          entries: 1,
          files: 1,
          import_id: "imp_wrong_binding_0001",
          schema_version: 1,
          totalUncompressedBytes: 13,
        })}\n`,
      );
      await writeFile(
        resolve(sealedExtractionDirectory, "tree/wrapper/full.md"),
        "# Wrong Book\n",
      );

      const prepared = await prepareDraft({
        archivePath,
        importId,
        sealedExtractionDirectory,
        selectedCandidatePath: "wrapper/full.md",
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_prepare_invalid_0001",
        ),
      });

      expect(prepared.extractionSource).toBe("archive");
      expect(
        await readFile(
          resolve(prepared.extractedRoot, "wrapper/full.md"),
          "utf8",
        ),
      ).toContain("Archive Book");
      await expect(access(sealedExtractionDirectory)).rejects.toThrow();
    } finally {
      await dataRoot.cleanup();
    }
  });

  it("persists normalized Markdown and a bounded high-confidence printed-contents proposal", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const source = await readFile(printedTocFixturePath, "utf8");
      const archivePath = resolve(dataRoot.path, "printed-toc.zip");
      await writeFile(
        archivePath,
        buildZip({
          entries: [
            { data: source, name: "wrapper/full.md" },
            { data: "{", name: "wrapper/full_content_list.json" },
            { data: "%PDF-origin", name: "wrapper/book_origin.pdf" },
          ],
        }),
      );
      const drafts = new DraftRepository(database);
      const imports = new ImportRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Pending import" });
      const imported = imports.createUploaded({
        bookId: book.id,
        expiresAtMs: 10_000,
        id: "imp_abcdefghijklmnop",
        nowMs: 2,
        uploadRelativePath: "tmp/uploads/imp_abcdefghijklmnop/original.zip",
        uploadSha256: sha256,
        uploadSizeBytes: (await readFile(archivePath)).byteLength,
      });
      imports.startAnalysis(imported.id, 3);
      imports.saveCandidates({
        candidates: [candidate()],
        importId: imported.id,
        nextState: "preparing",
        nowMs: 4,
        selectedCandidateId: candidate().id,
      });

      const prepared = await prepareDraft({
        archivePath,
        pdfEvidenceReader: async () => {
          throw new Error("PDF fallback must not run for a high boundary");
        },
        selectedCandidatePath: candidate().normalizedPath,
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_prepare_abcdefghijklmnop",
        ),
      });

      expect(prepared.artifact).toMatchObject({
        printedContents: [
          {
            boundaryConfidence: "high",
            canonical: true,
            confidence: "high",
            diagnostics: [],
            entryCount: 6,
            matchConfidence: "high",
            matchedHeadingCount: 6,
            regionId: expect.stringMatching(/^region_/u),
          },
        ],
        sourceRegions: [
          {
            applied: true,
            disposition: "reference_only",
            entries: expect.arrayContaining([
              expect.objectContaining({ reference_level: 1 }),
              expect.objectContaining({ reference_level: 2 }),
            ]),
            kind: "printed_toc",
          },
        ],
        title: "第 1 章 绪论",
        typography: expect.objectContaining({
          profile: "zh-smart-v1",
        }),
      });
      expect(prepared.artifact.structure).toHaveLength(9);

      const finalized = await finalizePreparedDraft({
        artifact: prepared.artifact,
        database,
        extractedRoot: prepared.extractedRoot,
        importId: imported.id,
        layout: dataRoot.layout,
        nowMs: 5,
        originalArchivePath: archivePath,
      });
      const config = drafts.requireConfig(book.id, 1);
      const parsedConfig = parseBookConfigYaml(
        await readFile(
          resolve(dataRoot.layout.root, config.yamlRelativePath),
          "utf8",
        ),
      );
      const acceptedMarkdown = await readFile(
        resolve(
          dataRoot.layout.root,
          finalized.snapshot.source.sourceRootRelativePath,
          finalized.snapshot.source.mainMarkdownPath,
        ),
        "utf8",
      );

      expect(acceptedMarkdown).toContain("中文与 English 排版");
      expect(parsedConfig).toMatchObject({
        schema_version: 3,
        source: {
          main_markdown_sha256: finalized.snapshot.source.mainMarkdownSha256,
          preprocessing: {
            typography: {
              output_sha256: finalized.snapshot.source.mainMarkdownSha256,
              profile: "zh-smart-v1",
            },
          },
        },
        source_regions: [
          {
            applied: true,
            disposition: "reference_only",
            kind: "printed_toc",
            source_path: finalized.snapshot.source.mainMarkdownPath,
            source_sha256: finalized.snapshot.source.mainMarkdownSha256,
          },
        ],
        title: "第 1 章 绪论",
      });
      const analysisPath = resolve(
        dataRoot.layout.bookDirectory,
        String(book.id),
        "draft",
        "analyses",
        finalized.snapshot.source.id,
        "1.json",
      );
      expect(
        parsePrintedContentsAnalysisV2(
          JSON.parse(await readFile(analysisPath, "utf8")),
        ),
      ).toMatchObject({
        config_revision: 1,
        identity: printedContentsAnalysisIdentity,
        source_id: finalized.snapshot.source.id,
      });
      await expect(
        access(
          resolve(
            dataRoot.layout.root,
            finalized.snapshot.source.sourceRootRelativePath,
            "printed-contents-analysis.json",
          ),
        ),
      ).rejects.toThrow();
    }));

  it("uses the unique original PDF only after automatic boundary evidence is insufficient", async () => {
    const dataRoot = await import("../../helpers/data-root.js").then(
      ({ createTemporaryDataRoot }) =>
        createTemporaryDataRoot("prepare-pdf-fallback"),
    );
    try {
      const archivePath = resolve(dataRoot.path, "fallback.zip");
      await writeFile(
        archivePath,
        buildZip({
          entries: [
            {
              data: "# Book\n\n## Chapter\n\nBody.\n",
              name: "wrapper/full.md",
            },
            { data: "%PDF-origin", name: "wrapper/book_origin.pdf" },
            { data: "%PDF-layout", name: "wrapper/book_layout.pdf" },
          ],
        }),
      );
      const reader = vi.fn(
        async (input: Parameters<typeof readPdfContentsEvidence>[0]) => {
          expect(input.pdfPath).toContain("book_origin.pdf");
          return Object.freeze({
            diagnostics: Object.freeze([
              Object.freeze({ code: "PDF_CONTENTS_NOT_DETECTED" as const }),
            ]),
            inspectedPageIndices: Object.freeze([1]),
            records: Object.freeze([
              Object.freeze({
                pageIndex: 1,
                sourceOrder: 0,
                text: "Contents",
                type: "text",
              }),
            ]),
            source: "native-pdf" as const,
          });
        },
      );

      const prepared = await prepareDraft({
        archivePath,
        pdfEvidenceReader: reader,
        selectedCandidatePath: "wrapper/full.md",
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_prepare_pdf_fallback",
        ),
      });

      expect(reader).toHaveBeenCalledOnce();
      expect(reader.mock.calls[0]?.[0].pdfPath).toBe(
        resolve(prepared.extractedRoot, "wrapper/book_origin.pdf"),
      );
      expect(prepared.artifact).toMatchObject({
        layoutSource: "native-pdf",
        pdfDiagnostics: [{ code: "PDF_CONTENTS_NOT_DETECTED" }],
      });
    } finally {
      await dataRoot.cleanup();
    }
  });

  it("allows bounded OCR for a damaged row inside a high-confidence boundary", async () => {
    const dataRoot = await import("../../helpers/data-root.js").then(
      ({ createTemporaryDataRoot }) =>
        createTemporaryDataRoot("prepare-pdf-line-repair"),
    );
    try {
      const source = [
        "## Contents",
        "",
        "1 Start ...... 1",
        "",
        "1.1 Missing page",
        "",
        "1.2 End ...... 3",
        "",
        "## 1 Start",
        "",
        "Body.",
        "",
        "## 1.1 Missing page",
        "",
        "Body.",
        "",
        "## 1.2 End",
        "",
        "Body.",
      ].join("\n");
      const archivePath = resolve(dataRoot.path, "line-repair.zip");
      await writeFile(
        archivePath,
        buildZip({
          entries: [
            { data: source, name: "wrapper/full.md" },
            { data: "%PDF-origin", name: "wrapper/book_origin.pdf" },
          ],
        }),
      );
      const reader = vi.fn(
        async (input: Parameters<typeof readPdfContentsEvidence>[0]) => {
          expect(input.allowOcr).toBe(true);
          return Object.freeze({
            diagnostics: Object.freeze([]),
            inspectedPageIndices: Object.freeze([0]),
            records: Object.freeze(
              [
                "1 Start ...... 1",
                "1.1 Missing page ...... 2",
                "1.2 End ...... 3",
              ].map((text, index) =>
                Object.freeze({
                  bbox: [20, 20 + index * 40, 700, 40 + index * 40] as const,
                  pageIndex: 0,
                  sourceOrder: index,
                  text,
                  type: "text" as const,
                }),
              ),
            ),
            source: "native-pdf" as const,
          });
        },
      );

      const prepared = await prepareDraft({
        archivePath,
        pdfEvidenceReader: reader,
        selectedCandidatePath: "wrapper/full.md",
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_prepare_pdf_line_repair",
        ),
      });

      expect(reader).toHaveBeenCalledOnce();
      expect(prepared.artifact).toMatchObject({
        layoutSource: "native-pdf",
        printedContents: [
          expect.objectContaining({ boundaryConfidence: "high" }),
        ],
      });
    } finally {
      await dataRoot.cleanup();
    }
  });

  it("creates an immutable initial config and a revision-pinned ready preview", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const image = await sharp({
        create: {
          background: { alpha: 1, b: 3, g: 2, r: 1 },
          channels: 4,
          height: 2,
          width: 2,
        },
      })
        .png()
        .toBuffer();
      const archivePath = resolve(dataRoot.path, "input.zip");
      await writeFile(
        archivePath,
        buildZip({
          entries: [
            {
              data: [
                "# Prepared Book",
                "",
                "## Chapter",
                "",
                "Text with $x+1$.",
                "",
                "![figure](images/a.png)",
              ].join("\n"),
              name: "wrapper/full.md",
            },
            { data: "[{}]", name: "wrapper/content_list.json" },
            { data: image, name: "wrapper/images/a.png" },
          ],
        }),
      );
      const drafts = new DraftRepository(database);
      const imports = new ImportRepository(database);
      const book = drafts.createBook({ nowMs: 1, title: "Pending import" });
      const imported = imports.createUploaded({
        bookId: book.id,
        expiresAtMs: 10_000,
        id: "imp_abcdefghijklmnop",
        nowMs: 2,
        uploadRelativePath: "tmp/uploads/imp_abcdefghijklmnop/original.zip",
        uploadSha256: sha256,
        uploadSizeBytes: (await readFile(archivePath)).byteLength,
      });
      imports.startAnalysis(imported.id, 3);
      imports.saveCandidates({
        candidates: [candidate()],
        importId: imported.id,
        nextState: "preparing",
        nowMs: 4,
        selectedCandidateId: candidate().id,
      });

      const prepared = await prepareDraft({
        archivePath,
        selectedCandidatePath: candidate().normalizedPath,
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_prepare_abcdefghijklmnop",
        ),
      });
      const finalized = await finalizePreparedDraft({
        artifact: prepared.artifact,
        database,
        extractedRoot: prepared.extractedRoot,
        importId: imported.id,
        layout: dataRoot.layout,
        nowMs: 5,
        originalArchivePath: archivePath,
      });
      const config = drafts.requireConfig(book.id, 1);
      const configPath = resolve(dataRoot.layout.root, config.yamlRelativePath);
      const parsedConfig = parseBookConfigYaml(
        await readFile(configPath, "utf8"),
      );

      expect(parsedConfig).toMatchObject({
        book_id: book.id,
        revision: 1,
        schema_version: 3,
        source: expect.objectContaining({
          preprocessing: {
            typography: expect.objectContaining({
              profile: "zh-smart-v1",
            }),
          },
        }),
        source_regions: [],
        structure: [
          expect.objectContaining({
            display_level: 1,
            include_in_toc: true,
            role: "body",
            starts_page: true,
          }),
          expect.objectContaining({
            display_level: 2,
            include_in_toc: true,
            starts_page: false,
          }),
        ],
        title: "Prepared Book",
      });
      expect(imports.require(imported.id)).toMatchObject({
        bookId: book.id,
        state: "draft_ready",
      });
      expect(finalized.candidate).toMatchObject({
        configRevision: 1,
        sourceId: finalized.snapshot.source.id,
        state: "building",
      });
      expect(drafts.requireBook(book.id)).toMatchObject({
        currentCandidateId: finalized.candidate.attemptId,
        draftConfigRevision: 1,
        draftSourceId: finalized.snapshot.source.id,
      });
    }));

  it("cleans a claimed extraction when canceled and re-extracts on retry", async () => {
    const dataRoot = await import("../../helpers/data-root.js").then(
      ({ createTemporaryDataRoot }) =>
        createTemporaryDataRoot("prepare-canceled"),
    );
    try {
      const archivePath = resolve(dataRoot.path, "canceled.zip");
      const importId = "imp_prepare_canceled_0001";
      const sealedExtractionDirectory = resolve(
        dataRoot.layout.uploadDirectory,
        importId,
        "sealed-extraction",
      );
      await writeFile(
        archivePath,
        buildZip({
          entries: [{ data: "# Book\n\nBody.\n", name: "wrapper/full.md" }],
        }),
      );
      await analyzeImport({
        archivePath,
        importId,
        sealedExtractionDirectory,
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_analyze_canceled_0001",
        ),
      });
      const stagingDirectory = resolve(
        dataRoot.path,
        "staging/job_prepare_canceled_0001",
      );
      const controller = new AbortController();
      controller.abort();

      await expect(
        prepareDraft({
          archivePath,
          importId,
          sealedExtractionDirectory,
          selectedCandidatePath: "wrapper/full.md",
          signal: controller.signal,
          stagingDirectory,
        }),
      ).rejects.toThrow();
      await expect(access(stagingDirectory)).rejects.toThrow();
      await expect(access(sealedExtractionDirectory)).rejects.toThrow();

      const retry = await prepareDraft({
        archivePath,
        importId,
        sealedExtractionDirectory,
        selectedCandidatePath: "wrapper/full.md",
        stagingDirectory: resolve(
          dataRoot.path,
          "staging/job_prepare_canceled_retry_0001",
        ),
      });
      expect(retry.extractionSource).toBe("archive");
    } finally {
      await dataRoot.cleanup();
    }
  });
});
