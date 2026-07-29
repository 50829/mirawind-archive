import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { printedContentsAnalysisIdentity } from "@/modules/publishing/core/preparation/printed-contents-analysis";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { createStrongEtag } from "@/http/cache/policies";
import { parseBookConfigYaml } from "@/modules/publishing/core/publication/book-config-schema";
import {
  patchDraftConfig,
  replaceDraftConfig,
} from "@/modules/publishing/adapters/filesystem/config-revisions";

import { withMigratedTestDatabase } from "../../helpers/database.js";

const blockId = "blk_config_revision_heading_0001";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function config(input: {
  readonly level?: number;
  readonly regionApplied?: boolean;
  readonly revision: number;
  readonly sourceHash: string;
  readonly title: string;
}) {
  return {
    book_id: 1,
    publishing: {
      code: { line_numbers: false },
      numbering: { mode: "normalized" },
    },
    revision: input.revision,
    schema_version: 3,
    source: {
      main_markdown: "book.md",
      main_markdown_sha256: input.sourceHash,
      original_files: [],
      preprocessing: {
        typography: {
          input_sha256: input.sourceHash,
          output_sha256: input.sourceHash,
          profile: "verbatim-v1",
          protected_nodes: 0,
          punctuation_converted: 0,
          spaces_normalized: 0,
        },
      },
    },
    source_regions:
      input.regionApplied === undefined
        ? []
        : [
            {
              applied: input.regionApplied,
              disposition: "reference_only",
              entries: [],
              kind: "printed_toc",
              range: {
                end_byte: 16,
                sha256: sha256("# Source heading"),
                start_byte: 0,
              },
              region_id: "region_config_revision_0001",
              source_path: "book.md",
              source_sha256: input.sourceHash,
            },
          ],
    structure: [
      {
        block_id: blockId,
        display_level: input.level ?? 1,
        include_in_toc: true,
        role: "body",
        starts_page: true,
      },
    ],
    title: input.title,
  };
}

async function fixture(
  database: Database.Database,
  layout: {
    readonly bookDirectory: string;
    readonly root: string;
  },
  regionApplied?: boolean,
) {
  const markdown = "# Source heading\n\nBody.";
  const markdownHash = sha256(markdown);
  const drafts = new DraftRepository(database);
  const book = drafts.createBook({ nowMs: 1, title: "Initial" });
  const imported = new ImportRepository(database).createUploaded({
    bookId: book.id,
    expiresAtMs: 1_000_000,
    id: "imp_config_revision_test_0001",
    nowMs: 2,
    uploadRelativePath: "tmp/import.zip",
    uploadSha256: "a".repeat(64),
    uploadSizeBytes: 1,
  });
  const sourceRoot = resolve(
    layout.bookDirectory,
    String(book.id),
    "draft",
    "sources",
    "src_config_revision_test_0001",
  );
  await mkdir(sourceRoot, { mode: 0o700, recursive: true });
  await writeFile(resolve(sourceRoot, "book.md"), markdown, { mode: 0o400 });
  const source = new SourceRepository(database).createSnapshot({
    analysisVersion: "test-v1",
    bookId: book.id,
    createdFromImportId: imported.id,
    id: "src_config_revision_test_0001",
    mainMarkdownPath: "book.md",
    mainMarkdownSha256: markdownHash,
    nowMs: 3,
    sourceRootRelativePath: `books/${book.id}/draft/sources/src_config_revision_test_0001`,
  });
  const initial = config({
    ...(regionApplied === undefined ? {} : { regionApplied }),
    revision: 1,
    sourceHash: markdownHash,
    title: "Initial",
  });
  const yaml = stringify(initial, { lineWidth: 0 });
  const configPath = resolve(
    layout.bookDirectory,
    String(book.id),
    "draft",
    "configs",
    "1",
    "book.yaml",
  );
  await mkdir(resolve(configPath, ".."), { mode: 0o700, recursive: true });
  await writeFile(configPath, yaml, { mode: 0o400 });
  const analysisPath = resolve(
    layout.bookDirectory,
    String(book.id),
    "draft",
    "analyses",
    source.id,
    "1.json",
  );
  await mkdir(resolve(analysisPath, ".."), { mode: 0o700, recursive: true });
  await writeFile(
    analysisPath,
    JSON.stringify({
      candidates: [],
      canonical_region_id: null,
      config_revision: 1,
      evidence_diagnostics: [],
      identity: printedContentsAnalysisIdentity,
      layout_source: "none",
      pdf_diagnostics: [],
      source_id: source.id,
      source_sha256: markdownHash,
      typography: { risk_summaries: [], truncated: false },
    }),
    { mode: 0o400 },
  );
  drafts.addConfigRevision({
    bookId: book.id,
    nowMs: 4,
    revision: 1,
    schemaVersion: 3,
    sourceId: source.id,
    title: "Initial",
    yamlRelativePath: `books/${book.id}/draft/configs/1/book.yaml`,
    yamlSha256: sha256(yaml),
  });
  return {
    book,
    currentEtag: createStrongEtag(sha256(yaml)),
    initialYaml: yaml,
    markdownHash,
  };
}

describe("atomic draft configuration revisions", () => {
  it("rejects source-region adjudication patches", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const setup = await fixture(database, dataRoot.layout, true);
      await expect(
        patchDraftConfig({
          bookId: setup.book.id,
          database,
          expectedEtag: setup.currentEtag,
          layout: dataRoot.layout,
          nowMs: 10,
          patch: {
            changes: [],
            regions: [
              {
                applied: false,
                region_id: "region_config_revision_0001",
              },
            ],
          },
        }),
      ).rejects.toMatchObject({ code: "DRAFT_PATCH_INVALID" });

      expect(
        new DraftRepository(database).requireBook(setup.book.id),
      ).toMatchObject({
        draftConfigRevision: 1,
      });
    }));

  it("merges a strict block patch without accepting unknown fields", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const setup = await fixture(database, dataRoot.layout);
      await expect(
        patchDraftConfig({
          bookId: setup.book.id,
          database,
          expectedEtag: setup.currentEtag,
          layout: dataRoot.layout,
          nowMs: 9,
          patch: {
            changes: [{ block_id: blockId, unknown: true }],
          },
        }),
      ).rejects.toMatchObject({ code: "DRAFT_PATCH_INVALID" });

      const result = await patchDraftConfig({
        bookId: setup.book.id,
        database,
        expectedEtag: setup.currentEtag,
        layout: dataRoot.layout,
        nowMs: 10,
        patch: {
          changes: [
            {
              block_id: blockId,
              display_level: 1,
              display_title: "Edited heading",
              include_in_toc: false,
            },
          ],
        },
      });
      const persisted = parseBookConfigYaml(
        await readFile(
          resolve(
            dataRoot.layout.root,
            new DraftRepository(database).requireConfig(setup.book.id, 2)
              .yamlRelativePath,
          ),
          "utf8",
        ),
      );
      expect(result).toMatchObject({ revision: 2 });
      expect(persisted.structure).toEqual([
        expect.objectContaining({
          block_id: blockId,
          display_level: 1,
          display_title: "Edited heading",
          include_in_toc: false,
          starts_page: true,
        }),
      ]);
    }));

  it("writes a read-only immutable revision and atomically queues its preview", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const setup = await fixture(database, dataRoot.layout);
      const next = config({
        revision: 2,
        sourceHash: setup.markdownHash,
        title: "Edited",
      });
      const result = await replaceDraftConfig({
        bookId: setup.book.id,
        config: next,
        database,
        expectedEtag: setup.currentEtag,
        layout: dataRoot.layout,
        nowMs: 10,
      });

      expect(result).toMatchObject({ revision: 2 });
      expect(result.etag).not.toBe(setup.currentEtag);
      const drafts = new DraftRepository(database);
      expect(drafts.requireBook(setup.book.id)).toMatchObject({
        draftConfigRevision: 2,
        readyPreviewRevision: null,
        title: "Edited",
      });
      const revision = drafts.requireConfig(setup.book.id, 2);
      const persisted = parseBookConfigYaml(
        await readFile(
          resolve(dataRoot.layout.root, revision.yamlRelativePath),
          "utf8",
        ),
      );
      expect(persisted).toMatchObject({
        schema_version: 3,
        source: {
          preprocessing: {
            typography: {
              input_sha256: setup.markdownHash,
              output_sha256: setup.markdownHash,
              profile: "verbatim-v1",
            },
          },
        },
        source_regions: [],
        title: "Edited",
      });
      expect(revision.schemaVersion).toBe(3);
      expect(
        (await stat(resolve(dataRoot.layout.root, revision.yamlRelativePath)))
          .mode & 0o777,
      ).toBe(0o400);
      expect(new JobRepository(database).get(result.jobId)).toMatchObject({
        capturedConfigRevision: 2,
        capturedSourceId: drafts.requireBook(setup.book.id).draftSourceId,
        kind: "build_preview",
        state: "queued",
      });
      expect(drafts.requirePreview(setup.book.id, 2)).toMatchObject({
        createdByJobId: result.jobId,
        state: "building",
      });
      const nextAnalysisPath = resolve(
        dataRoot.layout.bookDirectory,
        String(setup.book.id),
        "draft",
        "analyses",
        drafts.requireBook(setup.book.id).draftSourceId ?? "missing",
        "2.json",
      );
      expect(
        JSON.parse(await readFile(nextAnalysisPath, "utf8")),
      ).toMatchObject({
        config_revision: 2,
        identity: printedContentsAnalysisIdentity,
        source_sha256: setup.markdownHash,
      });
      expect((await stat(nextAnalysisPath)).mode & 0o777).toBe(0o400);
      expect(
        await readFile(
          resolve(
            dataRoot.layout.bookDirectory,
            String(setup.book.id),
            "draft",
            "configs",
            "1",
            "book.yaml",
          ),
          "utf8",
        ),
      ).toBe(setup.initialYaml);
    }));

  it("rejects stale ETags and invalid semantic structure without selecting a revision", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const setup = await fixture(database, dataRoot.layout);
      const next = config({
        level: 2,
        revision: 2,
        sourceHash: setup.markdownHash,
        title: "Invalid",
      });

      await expect(
        replaceDraftConfig({
          bookId: setup.book.id,
          config: next,
          database,
          expectedEtag: '"stale"',
          layout: dataRoot.layout,
          nowMs: 10,
        }),
      ).rejects.toMatchObject({ code: "DRAFT_PRECONDITION_FAILED" });
      await expect(
        replaceDraftConfig({
          bookId: setup.book.id,
          config: next,
          database,
          expectedEtag: setup.currentEtag,
          layout: dataRoot.layout,
          nowMs: 11,
        }),
      ).rejects.toMatchObject({ code: "BOOK_CONFIG_SEMANTIC_INVALID" });
      expect(
        new DraftRepository(database).requireBook(setup.book.id),
      ).toMatchObject({ draftConfigRevision: 1, title: "Initial" });
      await expect(
        stat(
          resolve(
            dataRoot.layout.bookDirectory,
            String(setup.book.id),
            "draft",
            "configs",
            "2",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }));

  it("rejects a missing pinned analysis without leaving a new revision", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const setup = await fixture(database, dataRoot.layout);
      const analysisDirectory = resolve(
        dataRoot.layout.bookDirectory,
        String(setup.book.id),
        "draft",
        "analyses",
        "src_config_revision_test_0001",
      );
      await rm(resolve(analysisDirectory, "1.json"));

      await expect(
        replaceDraftConfig({
          bookId: setup.book.id,
          config: config({
            revision: 2,
            sourceHash: setup.markdownHash,
            title: "Edited",
          }),
          database,
          expectedEtag: setup.currentEtag,
          layout: dataRoot.layout,
          nowMs: 10,
        }),
      ).rejects.toMatchObject({ code: "DRAFT_ANALYSIS_INVALID" });

      expect(
        new DraftRepository(database).requireBook(setup.book.id),
      ).toMatchObject({ draftConfigRevision: 1, title: "Initial" });
      await expect(
        stat(
          resolve(
            dataRoot.layout.bookDirectory,
            String(setup.book.id),
            "draft",
            "configs",
            "2",
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        stat(resolve(analysisDirectory, "2.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }));
});
