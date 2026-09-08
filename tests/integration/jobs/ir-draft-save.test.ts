import { required } from "../../helpers/required";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { withMigratedTestDatabase } from "../../helpers/database";
import { installIrDraft } from "../../helpers/ir-book";
import { queueDraftSave } from "@/modules/publishing/adapters/filesystem/queue-draft-save";
import { readDraftDocument } from "@/modules/publishing/adapters/filesystem/draft-document";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftSaveRepository } from "@/modules/publishing/adapters/sqlite/draft-saves";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import {
  JobRepository,
  type UserJobRecord,
} from "@/modules/publishing/adapters/sqlite/jobs";
import { prepareDraftSave } from "@/modules/publishing/adapters/worker/prepare-draft-save";
import { finalizeDraftSave } from "@/modules/publishing/adapters/worker/finalize-draft-save";
import { recoverDraftSaves } from "@/modules/publishing/adapters/worker/recover-draft-saves";
import { captureFrozenJobInput } from "@/composition/worker/capture-frozen-input";
import { createPublishingJobServer } from "@/composition/server/publishing-jobs";
import { createOpaqueId } from "@/domain/ids";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";
describe("durable IR saves", () => {
  it("accepts a save after wall-clock rollback while canceling its older preview", async () => {
    await withMigratedTestDatabase(async ({ database }, { layout }) => {
      const fixture = await installIrDraft(database, layout);
      const saved = queueDraftSave({
        database,
        layout,
        bookId: fixture.book.book_id,
        expectedUpdatedAt: 1000,
        patch: { metadata: { title: "Changed" } },
        nowMs: 1,
      });
      expect(new JobRepository(database).get(saved.job_id)?.state).toBe(
        "queued",
      );
      expect(
        new DraftCandidateRepository(database).require(
          fixture.candidate.attemptId,
        ),
      ).toMatchObject({
        state: "canceled",
        completedAtMs: fixture.candidate.createdAtMs,
      });
    });
  });
  it("accepts once, keeps block identities, rejects stale editors, and rebuilds the accepted timestamp", async () => {
    await withMigratedTestDatabase(async ({ database }, { layout }) => {
      const fixture = await installIrDraft(database, layout);
      const candidates = new DraftCandidateRepository(database);
      const jobs = new JobRepository(database);
      const saved = queueDraftSave({
        database,
        layout,
        bookId: fixture.book.book_id,
        expectedUpdatedAt: 1000,
        patch: { metadata: { title: "Edited" } },
        nowMs: 3,
      });
      expect(jobs.get(fixture.candidate.jobId)?.state).toBe("canceled");
      const job = required(jobs.claimNext({ leaseOwner: "test", nowMs: 4 }));
      expect(job.id).toBe(saved.job_id);
      const command = await captureFrozenJobInput({
        database,
        layout,
        job,
        candidates,
        imports: new ImportRepository(database),
      });
      if (command.kind !== "save_draft") throw new Error("Wrong job");
      const result = await prepareDraftSave({
        root: layout.root,
        bookId: fixture.book.book_id,
        requestPath: resolve(layout.root, command.requestRelativePath),
        stagingDirectory: resolve(layout.root, "staging", job.id),
      });
      const accepted = await finalizeDraftSave({
        database,
        layout,
        jobId: job.id,
        leaseOwner: "test",
        nowMs: 5,
        result,
      });
      const book = await readDraftDocument(layout, fixture.book.book_id);
      expect(book.metadata.title).toBe("Edited");
      expect(book.blocks.map((block) => block.id)).toEqual(
        fixture.book.blocks.map((block) => block.id),
      );
      expect(accepted.updated_at).toBe(book.updated_at);
      expect(candidates.findCurrent(book.book_id)?.sourceUpdatedAt).toBe(
        book.updated_at,
      );
      expect(() =>
        queueDraftSave({
          database,
          layout,
          bookId: book.book_id,
          expectedUpdatedAt: 1000,
          patch: { metadata: { title: "Stale" } },
          nowMs: 6,
        }),
      ).toThrow();
      const buildJob = required(
        jobs.claimNext({ leaseOwner: "test", nowMs: 7 }),
      );
      expect(
        (
          await captureFrozenJobInput({
            database,
            layout,
            job: buildJob,
            candidates,
            imports: new ImportRepository(database),
          })
        ).kind,
      ).toBe("build_candidate");
    });
  });
  it.each([false, true])(
    "recovers a failure %s after the file replacement without losing resource registration",
    async (afterReplace) => {
      await withMigratedTestDatabase(async ({ database }, { layout }) => {
        const fixture = await installIrDraft(database, layout);
        const resourceId = createOpaqueId("resource");
        const upload = `tmp/covers/${resourceId}/upload`;
        await atomicWriteFile(
          resolve(layout.root, upload),
          await sharp({
            create: { width: 2, height: 2, channels: 3, background: "white" },
          })
            .png()
            .toBuffer(),
          { mode: 0o600 },
        );
        const jobs = new JobRepository(database);
        const candidates = new DraftCandidateRepository(database);
        const imported = new ImportRepository(database);
        const saved = queueDraftSave({
          database,
          layout,
          bookId: fixture.book.book_id,
          expectedUpdatedAt: 1000,
          patch: {
            kind: "cover",
            resource_id: resourceId,
            upload_path: upload,
            filename: "cover.png",
          },
          internal: true,
          nowMs: 3,
        });
        const job = required(jobs.claimNext({ leaseOwner: "test", nowMs: 4 }));
        const command = await captureFrozenJobInput({
          database,
          layout,
          job,
          candidates,
          imports: imported,
        });
        if (command.kind !== "save_draft") throw new Error("Wrong job");
        const result = await prepareDraftSave({
          root: layout.root,
          bookId: fixture.book.book_id,
          requestPath: resolve(layout.root, command.requestRelativePath),
          stagingDirectory: resolve(layout.root, "staging", job.id),
        });
        database.exec(
          afterReplace
            ? "CREATE TEMP TRIGGER fail_save BEFORE UPDATE OF title_cache ON books BEGIN SELECT RAISE(ABORT,'TEST_CRASH'); END"
            : "CREATE TEMP TRIGGER fail_save BEFORE INSERT ON book_resources BEGIN SELECT RAISE(ABORT,'TEST_CRASH'); END",
        );
        await expect(
          finalizeDraftSave({
            database,
            layout,
            jobId: job.id,
            leaseOwner: "test",
            nowMs: 5,
            result,
          }),
        ).rejects.toThrow("TEST_CRASH");
        expect(
          (await readDraftDocument(layout, fixture.book.book_id)).updated_at,
        ).toBe(afterReplace ? result.acceptedUpdatedAt : 1000);
        expect(
          database
            .prepare("SELECT 1 FROM book_resources WHERE id=?")
            .get(resourceId),
        ).toBeUndefined();
        database.exec("DROP TRIGGER fail_save");
        if (afterReplace) jobs.requestCancellation(job.id, 6);
        jobs.completeFailure({
          jobId: job.id,
          leaseOwner: "test",
          nowMs: 6,
          errorClass: afterReplace ? "canceled" : "infrastructure",
          errorCode: "TEST_CRASH",
        });
        await rm(resolve(layout.root, "staging", job.id), {
          recursive: true,
          force: true,
        });
        if (afterReplace) {
          await recoverDraftSaves({ database, layout, nowMs: 8 });
          expect(jobs.get(saved.job_id)?.state).toBe("succeeded");
        } else {
          const retry = createPublishingJobServer(database).retryJob(job.id, {
            automatic: false,
            nowMs: 7,
          });
          const claimed = jobs.claimNext({
            leaseOwner: "test",
            nowMs: 8,
          }) as UserJobRecord;
          expect(claimed.id).toBe(retry.id);
          const retryCommand = await captureFrozenJobInput({
            database,
            layout,
            job: claimed,
            candidates,
            imports: imported,
          });
          if (retryCommand.kind !== "save_draft") throw new Error("Wrong job");
          const retried = await prepareDraftSave({
            root: layout.root,
            bookId: fixture.book.book_id,
            requestPath: resolve(layout.root, retryCommand.requestRelativePath),
            stagingDirectory: resolve(layout.root, "staging", claimed.id),
          });
          expect(retried.acceptedUpdatedAt).toBe(result.acceptedUpdatedAt);
          await finalizeDraftSave({
            database,
            layout,
            jobId: claimed.id,
            leaseOwner: "test",
            nowMs: 9,
            result: retried,
          });
        }
        const book = await readDraftDocument(layout, fixture.book.book_id);
        expect(book.resources.map((resource) => resource.id)).toEqual([
          resourceId,
        ]);
        expect(book.updated_at).toBe(result.acceptedUpdatedAt);
        expect(
          database
            .prepare("SELECT 1 FROM book_resources WHERE id=?")
            .get(resourceId),
        ).toBeDefined();
        await expect(
          readFile(
            resolve(
              fixture.draft,
              "views",
              String(book.updated_at),
              "analysis.json",
            ),
          ),
        ).resolves.toBeDefined();
      });
    },
  );
  it("does not advance time on a no-op and restores the superseded preview after a failed save", async () => {
    await withMigratedTestDatabase(async ({ database }, { layout }) => {
      const fixture = await installIrDraft(database, layout);
      const jobs = new JobRepository(database);
      const candidates = new DraftCandidateRepository(database);
      queueDraftSave({
        database,
        layout,
        bookId: fixture.book.book_id,
        expectedUpdatedAt: 1000,
        patch: { metadata: { title: "Book" } },
        nowMs: 3,
      });
      const job = required(jobs.claimNext({ leaseOwner: "test", nowMs: 4 }));
      const command = await captureFrozenJobInput({
        database,
        layout,
        job,
        candidates,
        imports: new ImportRepository(database),
      });
      if (command.kind !== "save_draft") throw new Error("Wrong job");
      const result = await prepareDraftSave({
        root: layout.root,
        bookId: fixture.book.book_id,
        requestPath: resolve(layout.root, command.requestRelativePath),
        stagingDirectory: resolve(layout.root, "staging", job.id),
      });
      expect(result.noChange).toBe(true);
      expect(result.acceptedUpdatedAt).toBe(1000);
      jobs.completeFailure({
        jobId: job.id,
        leaseOwner: "test",
        nowMs: 5,
        errorClass: "validation",
        errorCode: "TEST_FAILURE",
      });
      await recoverDraftSaves({ database, layout, nowMs: 6 });
      expect(candidates.findCurrent(fixture.book.book_id)?.state).toBe(
        "building",
      );
      expect(
        candidates.findCurrent(fixture.book.book_id)?.sourceUpdatedAt,
      ).toBe(1000);
      expect(
        new DraftSaveRepository(database).pending(fixture.book.book_id),
      ).toBe(false);
    });
  });
  it("never preempts a running build for another book", async () => {
    await withMigratedTestDatabase(async ({ database }, { layout }) => {
      const first = await installIrDraft(database, layout);
      const jobs = new JobRepository(database);
      const active = required(jobs.claimNext({ leaseOwner: "test", nowMs: 3 }));
      expect(active.bookId).toBe(first.book.book_id);
      const second = await installIrDraft(database, layout);
      queueDraftSave({
        database,
        layout,
        bookId: second.book.book_id,
        expectedUpdatedAt: 1000,
        patch: { metadata: { title: "Other" } },
        nowMs: 4,
      });
      expect(jobs.get(active.id)?.cancellationRequestedAtMs).toBeNull();
      expect(jobs.claimNext({ leaseOwner: "other", nowMs: 5 })).toBeNull();
    });
  });
});
