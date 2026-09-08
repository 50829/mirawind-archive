import type Database from "better-sqlite3";
import {
  draftDocumentPath,
  readDraftHeader,
} from "../filesystem/draft-document";
import { DraftCandidateRepository } from "../sqlite/draft-candidate-repository";
import {
  DraftSaveRepository,
  type DraftSaveRecord,
} from "../sqlite/draft-saves";
import { finalizeDraftSave } from "./finalize-draft-save";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export async function recoverDraftSaves(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<void> {
  // Complete a replaced body before lease retries or orphan cleanup can run.
  const records = input.database
    .prepare(
      `SELECT request.* FROM save_draft_requests request
    JOIN jobs ON jobs.id=request.job_id JOIN books ON books.id=request.book_id
    WHERE request.accepted_updated_at IS NOT NULL AND request.no_change=0 AND jobs.state<>'succeeded'
      AND (jobs.state<>'running' OR jobs.lease_until<=?)
      AND NOT EXISTS (SELECT 1 FROM save_draft_requests completed JOIN jobs done ON done.id=completed.job_id
        WHERE completed.prepared_path=request.prepared_path AND done.state='succeeded')
      AND books.deletion_requested_at IS NULL`,
    )
    .all(input.nowMs) as DraftSaveRecord[];
  for (const request of records) {
    const header = readDraftHeader(
      draftDocumentPath(input.layout, request.book_id),
      request.book_id,
    );
    if (header.updated_at !== request.accepted_updated_at) continue;
    await finalizeDraftSave({
      ...input,
      jobId: request.job_id,
      leaseOwner: "recovery",
      recovery: true,
      result: {
        alreadyApplied: true,
        noChange: request.no_change === 1,
        acceptedUpdatedAt: request.accepted_updated_at,
        documentSha256: request.document_sha256,
      },
    });
  }
  const superseded = input.database
    .prepare(
      `SELECT candidate.book_id,candidate.id FROM draft_candidates candidate
    JOIN books ON books.current_candidate_id=candidate.id WHERE candidate.state='canceled'
      AND candidate.safe_error_code='CANDIDATE_SUPERSEDED' AND books.deletion_requested_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM jobs WHERE jobs.book_id=books.id AND kind='save_draft' AND state IN ('queued','running'))`,
    )
    .all() as { book_id: number; id: string }[];
  for (const item of superseded)
    withImmediateTransaction(input.database, () => {
      if (new DraftSaveRepository(input.database).pending(item.book_id)) return;
      const candidates = new DraftCandidateRepository(input.database);
      const candidate = candidates.findCurrent(item.book_id);
      if (candidate?.attemptId !== item.id) return;
      const header = readDraftHeader(
        draftDocumentPath(input.layout, item.book_id),
        item.book_id,
      );
      candidates.createForDocument({
        bookId: item.book_id,
        importId: candidate.importId,
        sourceUpdatedAt: header.updated_at,
        nowMs: input.nowMs,
      });
    });
}
