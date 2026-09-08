import { required } from "../../helpers/required";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { queueSourceReprocess } from "@/modules/publishing/adapters/filesystem/source-reprocess";
import { readDraftDocument } from "@/modules/publishing/adapters/filesystem/draft-document";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { prepareDraftSave } from "@/modules/publishing/adapters/worker/prepare-draft-save";
import { finalizeDraftSave } from "@/modules/publishing/adapters/worker/finalize-draft-save";
import { captureFrozenJobInput } from "@/composition/worker/capture-frozen-input";
import { buildCandidateHandler } from "@/composition/worker-child/handlers/publishing";
import type { MineruBookAnalysis } from "@/modules/publishing/adapters/worker/rebind-mineru-analysis";
import type { SafeDiagnostic } from "@/domain/errors";
import { inlineText } from "@/modules/publishing/core/content/content-tree";
import { withMigratedTestDatabase } from "../../helpers/database";
import { prepareIrBook } from "../../helpers/prepare-ir-book";
import {
  mineruZip,
  mineruTitle,
  mineruParagraph,
} from "../../helpers/mineru-v2";
describe("original v2 reprocessing", () => {
  it("keeps recovered contents evidence and diagnostic navigation bound to the saved blocks", () =>
    withMigratedTestDatabase(async ({ database }, { layout }) => {
      const fixture = await prepareIrBook(
        database,
        layout,
        mineruZip([
          [
            mineruTitle("Contents"),
            mineruParagraph("1 Alpha ...... 1"),
            mineruParagraph("1.1 Missing ...... 2"),
            mineruParagraph("2 Beta ...... 3"),
            mineruParagraph("3 Gamma ...... 4"),
          ],
          [
            mineruTitle("1 Alpha"),
            mineruParagraph("中文与English排版"),
            mineruTitle("2 Beta"),
            mineruParagraph("Body"),
            mineruTitle("3 Gamma"),
            mineruParagraph("Body"),
          ],
        ]),
      );
      const initial = await readDraftDocument(layout, fixture.book.id);
      const analysisFor = async (
        updatedAt: number,
      ): Promise<MineruBookAnalysis> =>
        JSON.parse(
          await readFile(
            resolve(
              layout.bookDirectory,
              String(fixture.book.id),
              "draft/views",
              String(updatedAt),
              "analysis.json",
            ),
            "utf8",
          ),
        );
      const initialAnalysis = await analysisFor(initial.updated_at);
      expect(initialAnalysis.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "PRINTED_TOC_UNMATCHED_ENTRY",
          blockId: expect.any(String),
        }),
      );
      const jobs = new JobRepository(database);
      const candidates = new DraftCandidateRepository(database);
      const imports = new ImportRepository(database);
      const now = Date.now();
      queueSourceReprocess({
        bookId: fixture.book.id,
        database,
        layout,
        expectedUpdatedAt: initial.updated_at,
        nowMs: now,
        profile: "verbatim-v1",
      });
      const job = required(
        jobs.claimNext({ leaseOwner: "test", nowMs: now + 1 }),
      );
      const command = await captureFrozenJobInput({
        job,
        candidates,
        imports,
        database,
        layout,
      });
      if (command.kind !== "save_draft") throw new Error("Wrong job");
      const result = await prepareDraftSave({
        root: layout.root,
        bookId: fixture.book.id,
        requestPath: resolve(layout.root, command.requestRelativePath),
        stagingDirectory: resolve(layout.root, "staging", job.id),
      });
      await finalizeDraftSave({
        database,
        layout,
        jobId: job.id,
        leaseOwner: "test",
        nowMs: Date.now(),
        result,
      });
      const saved = await readDraftDocument(layout, fixture.book.id);
      expect(saved.updated_at).toBeGreaterThan(initial.updated_at);
      const analysis = await analysisFor(saved.updated_at);
      const activeIds = new Set(saved.blocks.map((block) => block.id));
      expect(analysis.diagnostics.map((item) => item.blockId)).toEqual(
        initialAnalysis.diagnostics.map((item) => item.blockId),
      );
      expect(analysis.removed_block_ids).toEqual(
        initialAnalysis.removed_block_ids,
      );
      for (const candidate of analysis.printed_contents) {
        expect(candidate.proposedRegion?.block_ids).toEqual(
          analysis.removed_block_ids,
        );
        for (const entry of candidate.logicalEntries)
          if (entry.bodyHeadingBlockId)
            expect(activeIds.has(entry.bodyHeadingBlockId)).toBe(true);
        for (const diagnostic of candidate.diagnostics)
          if (diagnostic.blockId)
            expect(activeIds.has(diagnostic.blockId)).toBe(true);
      }
      const buildJob = required(
        jobs.claimNext({ leaseOwner: "test", nowMs: Date.now() }),
      );
      const build = await captureFrozenJobInput({
        job: buildJob,
        candidates,
        imports,
        database,
        layout,
      });
      if (build.kind !== "build_candidate") throw new Error("Wrong job");
      const built = await buildCandidateHandler(build, {
        root: layout.root,
        signal: new AbortController().signal,
        reportProgress() {},
      });
      if (!built.ok || !built.result) throw new Error("Candidate build failed");
      const previewRoot = resolve(
        layout.root,
        String(built.result.artifactRootRelativePath),
        "preview",
      );
      const preview = JSON.parse(
        await readFile(resolve(previewRoot, "diagnostics.json"), "utf8"),
      ) as {
        diagnostics: SafeDiagnostic[];
      };
      const diagnostic = required(
        preview.diagnostics.find(
          (item) => item.code === "PRINTED_TOC_UNMATCHED_ENTRY",
        ),
      );
      const target = required(
        diagnostic.targets?.find(
          (target) => target.kind === "select_structure",
        ),
      );
      if (target.kind !== "select_structure")
        throw new Error("Diagnostic target is not a heading");
      expect(target.blockId).toBe(initialAnalysis.diagnostics[0]?.blockId);
      expect(
        await readFile(
          resolve(previewRoot, "pages", `${target.pageId}.html`),
          "utf8",
        ),
      ).toContain(`id="${target.blockId}"`);
    }));

  it("reprocesses through the save protocol, preserves identities and original bytes, and rejects stale requests", () =>
    withMigratedTestDatabase(async ({ database }, { layout }) => {
      const original = mineruZip([
        [mineruTitle("Book"), mineruParagraph("中文与English排版")],
      ]);
      const fixture = await prepareIrBook(
        database,
        layout,
        original,
        "verbatim-v1",
      );
      const initial = await readDraftDocument(layout, fixture.book.id);
      const jobs = new JobRepository(database),
        candidates = new DraftCandidateRepository(database);
      const originalPath = resolve(
        layout.bookDirectory,
        String(fixture.book.id),
        "originals",
        fixture.prepared.artifact.original.id,
      );
      for (const profile of ["zh-smart-v2", "verbatim-v1"] as const) {
        const now = Date.now();
        const before = await readDraftDocument(layout, fixture.book.id);
        const queued = queueSourceReprocess({
          bookId: fixture.book.id,
          database,
          layout,
          expectedUpdatedAt: before.updated_at,
          nowMs: now,
          profile,
        });
        const job = required(
          jobs.claimNext({ leaseOwner: "test", nowMs: now + 1 }),
        );
        expect(job.id).toBe(queued.job_id);
        const command = await captureFrozenJobInput({
          job,
          candidates,
          imports: new ImportRepository(database),
          database,
          layout,
        });
        if (command.kind !== "save_draft") throw new Error("Wrong job");
        const result = await prepareDraftSave({
          root: layout.root,
          bookId: fixture.book.id,
          requestPath: resolve(layout.root, command.requestRelativePath),
          stagingDirectory: resolve(layout.root, "staging", job.id),
        });
        await finalizeDraftSave({
          database,
          layout,
          jobId: job.id,
          leaseOwner: "test",
          nowMs: Date.now(),
          result,
        });
        const saved = await readDraftDocument(layout, fixture.book.id);
        expect(saved.updated_at).toBeGreaterThan(before.updated_at);
        expect(saved.blocks.map((block) => block.id)).toEqual(
          initial.blocks.map((block) => block.id),
        );
        expect(saved.metadata).toEqual(initial.metadata);
        const paragraph = required(
          saved.blocks.find((block) => block.type === "paragraph"),
        );
        expect(inlineText(paragraph.content)).toBe(
          profile === "zh-smart-v2"
            ? "中文与 English 排版"
            : "中文与English排版",
        );
        expect(() =>
          queueSourceReprocess({
            bookId: fixture.book.id,
            database,
            layout,
            expectedUpdatedAt: before.updated_at,
            nowMs: 13,
            profile,
          }),
        ).toThrow();
      }
      expect(await readFile(originalPath)).toEqual(original);
      expect(
        database
          .prepare("SELECT current_version_id FROM books WHERE id=?")
          .get(fixture.book.id),
      ).toEqual({ current_version_id: null });
    }));
});
