import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  reconcilePublishingStorage,
  publishingOrphanGraceMs,
} from "@/modules/publishing/adapters/filesystem/storage-reconciliation";
import { queueDraftSave } from "@/modules/publishing/adapters/filesystem/queue-draft-save";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftSaveRepository } from "@/modules/publishing/adapters/sqlite/draft-saves";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import { JobRepository } from "@/modules/publishing/adapters/sqlite/jobs";
import { prepareDraftSave } from "@/modules/publishing/adapters/worker/prepare-draft-save";
import { finalizeDraftSave } from "@/modules/publishing/adapters/worker/finalize-draft-save";
import { recoverDraftSaves } from "@/modules/publishing/adapters/worker/recover-draft-saves";
import { captureFrozenJobInput } from "@/composition/worker/capture-frozen-input";
import { createPublishingJobServer } from "@/composition/server/publishing-jobs";
import { withMigratedTestDatabase } from "../../helpers/database";
import { installIrDraft } from "../../helpers/ir-book";

async function write(path: string, value = "fixture") {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, value, { mode: 0o600 });
}
async function exists(path: string) {
  return access(path).then(
    () => true,
    () => false,
  );
}

describe("IR storage reconciliation", () => {
  it("removes unregistered files and old views but preserves the body, registered originals and active snapshots", () =>
    withMigratedTestDatabase(async ({ database }, { layout }) => {
      const fixture = await installIrDraft(database, layout);
      const root = `books/${fixture.book.book_id}`;
      const orphans = [
        "tmp/uploads/imp_orphan_00000000000001",
        `${root}/assets/res_orphan_00000000000001`,
        `${root}/originals/file_orphan_00000000000001`,
        `${root}/draft/views/999`,
        `${root}/draft/saves/job_orphan_00000000000001`,
        `${root}/draft/candidates/candidate_orphan_00000000000001`,
      ];
      for (const path of orphans)
        await write(resolve(layout.root, path, "part"));
      await write(resolve(layout.root, fixture.candidate.inputRelativePath));
      const original = database
        .prepare("SELECT storage_rel_path FROM original_files WHERE book_id=?")
        .get(fixture.book.book_id) as { storage_rel_path: string };
      const result = await reconcilePublishingStorage({
        database,
        layout,
        nowMs: Date.now() + publishingOrphanGraceMs + 1000,
      });
      for (const path of orphans) {
        expect(result.removedOrphanPaths).toContain(path);
        expect(await exists(resolve(layout.root, path))).toBe(false);
      }
      for (const path of [
        `${root}/draft/book.json`,
        `${root}/draft/views/1000`,
        original.storage_rel_path,
        fixture.candidate.inputRelativePath,
      ])
        expect(await exists(resolve(layout.root, path))).toBe(true);
    }));

  it("cleans completed retry receipts without replaying the failed attempt or deleting the saved body", () =>
    withMigratedTestDatabase(async ({ database }, { layout }) => {
      const fixture = await installIrDraft(database, layout);
      const jobs = new JobRepository(database),
        candidates = new DraftCandidateRepository(database),
        imports = new ImportRepository(database);
      const prepare = async () => {
        const job = jobs.claimNext({ leaseOwner: "test", nowMs: Date.now() });
        if (!job) throw new Error("JOB_MISSING");
        const command = await captureFrozenJobInput({
          database,
          layout,
          job,
          candidates,
          imports,
        });
        if (command.kind !== "save_draft") throw new Error("JOB_INVALID");
        const result = await prepareDraftSave({
          root: layout.root,
          bookId: fixture.book.book_id,
          requestPath: resolve(layout.root, command.requestRelativePath),
          stagingDirectory: resolve(layout.root, "staging", job.id),
        });
        return { job, result };
      };
      queueDraftSave({
        database,
        layout,
        bookId: fixture.book.book_id,
        expectedUpdatedAt: 1000,
        patch: { metadata: { title: "Saved" } },
        nowMs: Date.now(),
      });
      const first = await prepare();
      database.exec(
        "CREATE TEMP TRIGGER fail_save BEFORE UPDATE OF title_cache ON books BEGIN SELECT RAISE(ABORT,'TEST_CRASH'); END",
      );
      await expect(
        finalizeDraftSave({
          database,
          layout,
          jobId: first.job.id,
          leaseOwner: "test",
          nowMs: Date.now(),
          result: first.result,
        }),
      ).rejects.toThrow("TEST_CRASH");
      database.exec("DROP TRIGGER fail_save");
      jobs.completeFailure({
        jobId: first.job.id,
        leaseOwner: "test",
        nowMs: Date.now(),
        errorClass: "infrastructure",
        errorCode: "TEST_CRASH",
      });
      createPublishingJobServer(database).retryJob(first.job.id, {
        automatic: false,
        nowMs: Date.now(),
      });
      const retry = await prepare();
      expect(retry.result.alreadyApplied).toBe(true);
      await finalizeDraftSave({
        database,
        layout,
        jobId: retry.job.id,
        leaseOwner: "test",
        nowMs: Date.now(),
        result: retry.result,
      });
      const receipt = new DraftSaveRepository(database).require(retry.job.id);
      expect(receipt.payload_json).toBe("{}");
      if (!receipt.prepared_path) throw new Error("RECEIPT_MISSING");
      const bytes = await readFile(resolve(fixture.draft, "book.json"));
      await recoverDraftSaves({ database, layout, nowMs: Date.now() });
      await reconcilePublishingStorage({
        database,
        layout,
        nowMs: Date.now() + publishingOrphanGraceMs + 1000,
      });
      expect(
        await exists(resolve(layout.root, dirname(receipt.prepared_path))),
      ).toBe(false);
      await recoverDraftSaves({ database, layout, nowMs: Date.now() });
      expect(jobs.get(first.job.id)?.state).toBe("failed");
      expect(jobs.get(retry.job.id)?.state).toBe("succeeded");
      expect(await readFile(resolve(fixture.draft, "book.json"))).toEqual(
        bytes,
      );
    }));

  it("keeps pending and retryable cover uploads and removes abandoned uploads", () =>
    withMigratedTestDatabase(async ({ database }, { layout }) => {
      const fixture = await installIrDraft(database, layout);
      const resourceId = "res_retained_cover_00000001";
      const retained = `tmp/covers/${resourceId}`;
      const orphan = "tmp/covers/res_abandoned_cover_000001";
      await write(resolve(layout.root, retained, "upload"));
      await write(resolve(layout.root, orphan, "upload"));
      const save = queueDraftSave({
        database,
        layout,
        bookId: fixture.book.book_id,
        expectedUpdatedAt: 1000,
        patch: {
          kind: "cover",
          resource_id: resourceId,
          upload_path: retained + "/upload",
          filename: "cover.png",
        },
        internal: true,
        nowMs: Date.now(),
      });
      const nowMs = Date.now() + publishingOrphanGraceMs + 1000;
      await reconcilePublishingStorage({ database, layout, nowMs });
      expect(await exists(resolve(layout.root, retained, "upload"))).toBe(true);
      expect(await exists(resolve(layout.root, orphan))).toBe(false);
      new JobRepository(database).requestCancellation(save.job_id, Date.now());
      await reconcilePublishingStorage({ database, layout, nowMs });
      expect(await exists(resolve(layout.root, retained, "upload"))).toBe(true);
    }));
});
