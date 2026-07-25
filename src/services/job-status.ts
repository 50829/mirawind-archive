import type { JobRecord } from "../db/repositories/jobs.js";
import type Database from "better-sqlite3";

type SafeProgressValue = boolean | number | string | null;

function timestamp(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function safeProgress(
  progress: Readonly<Record<string, unknown>>,
): Readonly<Record<string, SafeProgressValue>> {
  const output: Record<string, SafeProgressValue> = {};
  for (const [key, value] of Object.entries(progress).slice(0, 100)) {
    if (
      key.length < 1 ||
      key.length > 80 ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]*$/u.test(key)
    ) {
      continue;
    }
    if (
      value === null ||
      typeof value === "boolean" ||
      (typeof value === "number" && Number.isFinite(value))
    ) {
      output[key] = value;
    } else if (typeof value === "string") {
      output[key] = value.slice(0, 500);
    }
  }
  return Object.freeze(output);
}

function publicationOutcome(
  job: JobRecord,
  database: Database.Database | undefined,
) {
  if (
    !database ||
    job.kind !== "build_publish" ||
    job.state !== "succeeded" ||
    job.bookId === null ||
    job.versionId === null
  ) {
    return null;
  }
  const row = database
    .prepare(
      `SELECT books.id AS book_id, presentation.alias,
              presentation.first_page_id, presentation.first_page_alias,
              versions.id AS version_id
       FROM books
       JOIN book_versions AS versions
         ON versions.id = books.current_version_id
        AND versions.book_id = books.id
        AND versions.id = ?
        AND versions.state = 'published'
        AND versions.reclaimed_at IS NULL
       JOIN book_version_presentations AS presentation
         ON presentation.version_id = versions.id
        AND presentation.book_id = books.id
       WHERE books.id = ?
         AND books.deletion_requested_at IS NULL
       LIMIT 1`,
    )
    .get(job.versionId, job.bookId) as
    | {
        alias: string | null;
        book_id: number;
        first_page_alias: string | null;
        first_page_id: number;
        version_id: string;
      }
    | undefined;
  if (!row) return null;
  const bookKey = row.alias ?? String(row.book_id);
  const firstPageKey = row.first_page_alias ?? String(row.first_page_id);
  return Object.freeze({
    book_id: row.book_id,
    book_key: bookKey,
    details_url: `/books/${bookKey}`,
    library_url: "/library",
    start_url: `/read/${bookKey}/${firstPageKey}`,
    version_id: row.version_id,
  });
}

export function serializeJobStatus(
  job: JobRecord,
  database?: Database.Database,
) {
  const isDeletionCleanup =
    database !== undefined &&
    database
      .prepare(
        `SELECT 1 FROM book_deletions
         WHERE cleanup_job_id = ?`,
      )
      .get(job.id) !== undefined;
  return Object.freeze({
    attempt: job.attempt,
    automatic_retry_count: job.automaticRetryCount,
    created_at: new Date(job.createdAtMs).toISOString(),
    error_class: job.errorClass,
    error_code: job.errorCode,
    finished_at: timestamp(job.finishedAtMs),
    job_id: job.id,
    kind: isDeletionCleanup ? "permanent_book_deletion" : job.kind,
    phase: job.phase.slice(0, 80),
    ...(database ? { publication: publicationOutcome(job, database) } : {}),
    progress: safeProgress(job.progress),
    retry_of_job_id: job.retryOfJobId,
    started_at: timestamp(job.startedAtMs),
    state: job.state,
  });
}
