import { createHash } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";
import sharp from "sharp";
import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { printedContentsAnalysisIdentity } from "@/modules/publishing/core/preparation/printed-contents-analysis";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { createStrongEtag } from "@/http/cache/policies";
import { normalizeDocumentBlocks } from "@/modules/publishing/core/preparation/normalize-document";
import { parseMarkdownDocument } from "@/modules/publishing/core/preparation/parse-markdown";
import { parseBookConfigYaml } from "@/modules/publishing/core/publication/book-config-schema";
import {
  patchDraftConfig,
  replaceDraftConfig,
} from "@/modules/publishing/adapters/filesystem/config-revisions";
import {
  getDraftBlock,
  patchDraftBlock,
} from "@/modules/publishing/adapters/filesystem/draft-blocks";
import { uploadDraftCover } from "@/modules/publishing/adapters/filesystem/draft-cover";

import { withMigratedTestDatabase } from "../../helpers/database.js";
import {
  createBookConfigV4,
  structureForDocument,
} from "../../helpers/book-config";

const blockId = "blk_config_revision_heading_0001";
const sourceMarkdown = "# Source heading\n\nBody.";

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function config(input: {
  readonly level?: number;
  readonly revision: number;
  readonly sourceHash: string;
  readonly title: string;
}) {
  let contentOrdinal = 0;
  const document = normalizeDocumentBlocks(
    parseMarkdownDocument(sourceMarkdown),
    {
      idFactory: (node) =>
        node.type === "heading"
          ? blockId
          : `blk_config_revision_content_${String(++contentOrdinal).padStart(4, "0")}`,
    },
  );
  const structure = structureForDocument(document).map((node) => ({
    ...node,
    display_level: input.level ?? 1,
  }));
  return createBookConfigV4({
    document,
    revision: input.revision,
    sourceSha256: input.sourceHash,
    structure,
    title: input.title,
  });
}

async function fixture(
  database: Database.Database,
  layout: {
    readonly bookDirectory: string;
    readonly root: string;
  },
) {
  const markdown = sourceMarkdown;
  const markdownHash = sha256(markdown);
  const drafts = new DraftRepository(database);
  const book = drafts.createBook({ nowMs: 1, title: "Initial" });
  const imported = new ImportRepository(database).createUploaded({
    bookId: book.id,
    expiresAtMs: 1_000_000,
    id: "imp_config_revision_test_0001",
    nowMs: 2,
    originalName: "fixture.zip",
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
    origin: "import",
    sourceRootRelativePath: `books/${book.id}/draft/sources/src_config_revision_test_0001`,
  });
  const initial = config({
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
    schemaVersion: 4,
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
  it("adds an uploaded cover through a new immutable source revision", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const setup = await fixture(database, dataRoot.layout);
      const bytes = await sharp({
        create: {
          background: { alpha: 1, b: 32, g: 96, r: 16 },
          channels: 4,
          height: 1,
          width: 1,
        },
      })
        .png()
        .toBuffer();
      const result = await uploadDraftCover({
        bookId: setup.book.id,
        bytes,
        database,
        expectedEtag: setup.currentEtag,
        filename: "cover.png",
        layout: dataRoot.layout,
        nowMs: 10,
      });
      const drafts = new DraftRepository(database);
      const book = drafts.requireBook(setup.book.id);
      const source = new SourceRepository(database).requireSnapshot(
        book.draftSourceId ?? "",
      );
      const nextConfig = parseBookConfigYaml(
        await readFile(
          resolve(
            dataRoot.layout.root,
            drafts.requireConfig(setup.book.id, 2).yamlRelativePath,
          ),
          "utf8",
        ),
      );

      expect(result).toMatchObject({ revision: 2 });
      expect(nextConfig.metadata).toMatchObject({
        cover_path: result.coverPath,
      });
      expect(source).toMatchObject({
        mainMarkdownSha256: setup.markdownHash,
        origin: "edit",
        parentSourceId: "src_config_revision_test_0001",
      });
      expect(
        new SourceRepository(database).bindingsForSource(source.id),
      ).toEqual([
        expect.objectContaining({
          logicalPath: result.coverPath,
          sha256: sha256(bytes),
        }),
      ]);
      expect(
        await readFile(
          resolve(
            dataRoot.layout.root,
            source.sourceRootRelativePath,
            result.coverPath,
          ),
        ),
      ).toEqual(bytes);
    }));

  it("creates an immutable source revision and reuses bound assets for a block edit", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const setup = await fixture(database, dataRoot.layout);
      const sources = new SourceRepository(database);
      const assetId = "asset_config_revision_0001";
      const assetRelativePath = `books/${setup.book.id}/draft/assets/${assetId}`;
      const assetPath = resolve(dataRoot.layout.root, assetRelativePath);
      await mkdir(resolve(assetPath, ".."), { mode: 0o700, recursive: true });
      await writeFile(assetPath, "asset bytes", { mode: 0o400 });
      sources.registerAsset({
        bookId: setup.book.id,
        id: assetId,
        nowMs: 5,
        sha256: sha256("asset bytes"),
        sizeBytes: 11,
        storageRelativePath: assetRelativePath,
      });
      sources.bindAsset({
        assetId,
        logicalPath: "images/example.bin",
        sourceId: "src_config_revision_test_0001",
      });
      const originalResourcePath = resolve(
        dataRoot.layout.bookDirectory,
        String(setup.book.id),
        "draft",
        "sources",
        "src_config_revision_test_0001",
        "images",
        "example.bin",
      );
      await mkdir(resolve(originalResourcePath, ".."), {
        mode: 0o700,
        recursive: true,
      });
      await link(assetPath, originalResourcePath);

      const blockId = "blk_config_revision_content_0001";
      const current = await getDraftBlock({
        blockId,
        bookId: setup.book.id,
        database,
        layout: dataRoot.layout,
      });
      expect(current).toMatchObject({
        block_id: blockId,
        kind: "paragraph",
        markdown: "Body.",
      });

      const result = await patchDraftBlock({
        blockId,
        bookId: setup.book.id,
        database,
        expectedEtag: current.etag,
        layout: dataRoot.layout,
        nowMs: 10,
        patch: { markdown: "Edited body with `token`." },
      });
      const book = new DraftRepository(database).requireBook(setup.book.id);
      const editedSource = sources.requireSnapshot(book.draftSourceId ?? "");
      const editedRoot = resolve(
        dataRoot.layout.root,
        editedSource.sourceRootRelativePath,
      );
      const editedConfig = parseBookConfigYaml(
        await readFile(
          resolve(
            dataRoot.layout.root,
            new DraftRepository(database).requireConfig(setup.book.id, 2)
              .yamlRelativePath,
          ),
          "utf8",
        ),
      );

      expect(result).toMatchObject({
        revision: 2,
        selectedBlockId: blockId,
      });
      expect(editedSource).toMatchObject({
        origin: "edit",
        parentSourceId: "src_config_revision_test_0001",
      });
      expect(await readFile(resolve(editedRoot, "book.md"), "utf8")).toBe(
        "# Source heading\n\nEdited body with `token`.",
      );
      expect(
        (editedConfig.source as Record<string, unknown>).preprocessing,
      ).toMatchObject({
        source_edit: {
          block_id: blockId,
          input_sha256: setup.markdownHash,
          output_sha256: editedSource.mainMarkdownSha256,
        },
      });
      expect(sources.bindingsForSource(editedSource.id)).toEqual([
        expect.objectContaining({
          id: assetId,
          logicalPath: "images/example.bin",
        }),
      ]);
      expect((await stat(resolve(editedRoot, "images/example.bin"))).ino).toBe(
        (await stat(assetPath)).ino,
      );
      expect(
        await readFile(
          resolve(
            dataRoot.layout.bookDirectory,
            String(setup.book.id),
            "draft",
            "sources",
            "src_config_revision_test_0001",
            "book.md",
          ),
          "utf8",
        ),
      ).toBe(sourceMarkdown);
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
              include_in_toc: false,
              title_markdown: "Edited heading",
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
          include_in_toc: false,
          starts_page: true,
          title_markdown: "Edited heading",
        }),
      ]);
    }));

  it("writes a read-only immutable revision and atomically queues its preview", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const setup = await fixture(database, dataRoot.layout);
      const previousCandidate = new DraftCandidateRepository(
        database,
      ).createForCurrentRevision({
        bookId: setup.book.id,
        configRevision: 1,
        nowMs: 5,
        sourceId: "src_config_revision_test_0001",
      });
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
        currentCandidateId: result.candidate.attemptId,
        draftConfigRevision: 2,
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
        metadata: { title: "Edited" },
        schema_version: 4,
        source: {
          preprocessing: {
            typography: {
              input_sha256: setup.markdownHash,
              output_sha256: setup.markdownHash,
              profile: "verbatim-v1",
            },
          },
        },
      });
      expect(revision.schemaVersion).toBe(4);
      expect(
        (await stat(resolve(dataRoot.layout.root, revision.yamlRelativePath)))
          .mode & 0o777,
      ).toBe(0o400);
      expect(
        new JobRepository(database).get(result.candidate.jobId),
      ).toMatchObject({
        capturedConfigRevision: 2,
        capturedSourceId: drafts.requireBook(setup.book.id).draftSourceId,
        kind: "build_candidate",
        state: "queued",
      });
      expect(
        new DraftCandidateRepository(database).findCurrent(setup.book.id),
      ).toMatchObject({
        attemptId: result.candidate.attemptId,
        jobId: result.candidate.jobId,
        state: "building",
      });
      expect(
        new DraftCandidateRepository(database).require(
          previousCandidate.attemptId,
        ),
      ).toMatchObject({
        safeErrorCode: "CANDIDATE_SUPERSEDED",
        state: "discarded",
      });
      expect(
        new JobRepository(database).get(previousCandidate.jobId),
      ).toMatchObject({
        errorCode: "CANDIDATE_SUPERSEDED",
        state: "canceled",
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
