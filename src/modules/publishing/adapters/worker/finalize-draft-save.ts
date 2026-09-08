import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync } from "node:fs";
import { link, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import { DraftSaveRepository } from "../sqlite/draft-saves";
import {
  DraftCandidateRepository,
  type DraftCandidateRecord,
} from "../sqlite/draft-candidate-repository";
import { JobRepository } from "../sqlite/jobs";
import {
  draftDocumentPath,
  readDraftHeader,
} from "../filesystem/draft-document";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { SafeApplicationError } from "@/domain/errors";
import { isOpaqueId } from "@/domain/ids";

export async function finalizeDraftSave(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly jobId: string;
  readonly leaseOwner: string;
  readonly nowMs: number;
  readonly result: Readonly<Record<string, string | number | boolean | null>>;
  readonly recovery?: boolean;
}) {
  const saves = new DraftSaveRepository(input.database);
  const request = saves.require(input.jobId);
  const result = input.result;
  if (
    !Number.isSafeInteger(result.acceptedUpdatedAt) ||
    Number(result.acceptedUpdatedAt) < request.expected_updated_at ||
    Number(result.acceptedUpdatedAt) > 8_640_000_000_000_000 ||
    typeof result.documentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(result.documentSha256) ||
    typeof result.noChange !== "boolean" ||
    typeof result.alreadyApplied !== "boolean"
  )
    throw new Error("DRAFT_SAVE_RESULT_INVALID");
  const timestamp = Number(result.acceptedUpdatedAt);
  if (result.noChange !== (timestamp === request.expected_updated_at))
    throw new Error("DRAFT_SAVE_RESULT_INVALID");
  if (
    request.accepted_updated_at !== null &&
    (timestamp !== request.accepted_updated_at ||
      result.documentSha256 !== request.document_sha256)
  )
    throw new Error("DRAFT_SAVE_RESULT_INVALID");
  const staging = resolve(
    input.layout.root,
    "staging",
    input.jobId,
    "prepared-save",
  );
  const destination = draftDocumentPath(input.layout, request.book_id);
  const draftRoot = dirname(destination);
  if (
    request.prepared_path &&
    !new RegExp(
      `^books/${request.book_id}/draft/saves/job_[A-Za-z0-9_-]+/book\\.json$`,
      "u",
    ).test(request.prepared_path)
  )
    throw new Error("DRAFT_SAVE_RECEIPT_INVALID");
  const prepared = request.prepared_path
    ? dirname(resolve(input.layout.root, request.prepared_path))
    : resolve(draftRoot, "saves", input.jobId);
  if (!request.prepared_path) {
    await mkdir(dirname(prepared), { recursive: true, mode: 0o700 });
    // An unrecorded receipt cannot have replaced the authoritative document.
    await rm(prepared, { recursive: true, force: true });
    await rename(staging, prepared);
    const directory = openSync(dirname(prepared), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
  const source = result.alreadyApplied
    ? destination
    : resolve(prepared, "book.json");
  const header = readDraftHeader(source, request.book_id);
  const bytes = await readFile(source);
  if (
    header.updated_at !== timestamp ||
    createHash("sha256").update(bytes).digest("hex") !== result.documentSha256
  )
    throw new Error("DRAFT_SAVE_INTEGRITY_MISMATCH");
  const expectedCurrent = result.alreadyApplied
    ? timestamp
    : request.expected_updated_at;
  if (
    readDraftHeader(destination, request.book_id).updated_at !== expectedCurrent
  )
    throw new SafeApplicationError(
      "DRAFT_PRECONDITION_FAILED",
      "The draft changed since it was read.",
      412,
    );
  const viewRoot = resolve(draftRoot, "views", String(timestamp));
  const assets: {
    id: string;
    path: string;
    size: number;
    sha256: string;
    media_type: string;
  }[] = JSON.parse(await readFile(resolve(prepared, "assets.json"), "utf8"));
  if (!Array.isArray(assets) || assets.length > 20000)
    throw new Error("DRAFT_SAVE_ASSETS_INVALID");
  for (const asset of assets) {
    if (
      !isOpaqueId("resource", asset.id) ||
      !asset.path.startsWith(`assets/${asset.id}.`) ||
      asset.path.split("/").length !== 2 ||
      !/^[a-f0-9]{64}$/u.test(asset.sha256)
    )
      throw new Error("DRAFT_SAVE_ASSETS_INVALID");
    const destination = resolve(
      input.layout.bookDirectory,
      String(request.book_id),
      asset.path,
    );
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    try {
      await link(resolve(prepared, asset.path), destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const bytes = await readFile(destination);
    if (
      bytes.byteLength !== asset.size ||
      createHash("sha256").update(bytes).digest("hex") !== asset.sha256
    )
      throw new Error("DRAFT_SAVE_ASSET_CONFLICT");
  }
  if (assets.length) {
    const directory = openSync(
      resolve(input.layout.bookDirectory, String(request.book_id), "assets"),
      "r",
    );
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  }
  await mkdir(dirname(viewRoot), { recursive: true, mode: 0o700 });
  if (readDraftHeader(destination, request.book_id).updated_at !== timestamp)
    await rm(viewRoot, { recursive: true, force: true });
  if (
    !(await stat(viewRoot).then(
      () => true,
      () => false,
    ))
  ) {
    await mkdir(viewRoot, { recursive: true, mode: 0o700 });
    for (const name of [
      "view.json",
      "index.json",
      "blocks.ndjson",
      "analysis.json",
    ])
      await link(
        resolve(prepared, "views", String(timestamp), name),
        resolve(viewRoot, name),
      );
    for (const path of [viewRoot, dirname(viewRoot)]) {
      const directory = openSync(path, "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
  }
  const view = JSON.parse(
    await readFile(resolve(viewRoot, "view.json"), "utf8"),
  ) as { book_id: number; updated_at: number; metadata: { title: string } };
  if (view.book_id !== request.book_id || view.updated_at !== timestamp)
    throw new Error("DRAFT_VIEW_IDENTITY_INVALID");
  saves.prepared({
    jobId: input.jobId,
    timestamp,
    path: relative(input.layout.root, resolve(prepared, "book.json")),
    sha256: result.documentSha256,
    noChange: result.noChange,
  });
  return withImmediateTransaction(input.database, () => {
    const jobs = new JobRepository(input.database);
    const job = jobs.get(input.jobId);
    const book = input.database
      .prepare(
        "SELECT draft_import_id FROM books WHERE id=? AND deletion_requested_at IS NULL",
      )
      .get(request.book_id) as { draft_import_id: string } | undefined;
    if (
      !job ||
      (!input.recovery &&
        (job.state !== "running" ||
          job.leaseOwner !== input.leaseOwner ||
          job.cancellationRequestedAtMs !== null)) ||
      !book
    )
      throw new Error("DRAFT_SAVE_LEASE_LOST");
    const current = readDraftHeader(destination, request.book_id);
    if (
      input.recovery &&
      (!result.alreadyApplied || current.updated_at !== timestamp)
    )
      throw new Error("DRAFT_SAVE_RECOVERY_INVALID");
    if (current.updated_at !== expectedCurrent)
      throw new SafeApplicationError(
        "DRAFT_PRECONDITION_FAILED",
        "The draft changed since it was read.",
        412,
      );
    for (const asset of assets) {
      const existing = input.database
        .prepare("SELECT book_id,sha256 FROM book_resources WHERE id=?")
        .get(asset.id) as { book_id: number; sha256: string } | undefined;
      if (
        existing &&
        (existing.book_id !== request.book_id ||
          existing.sha256 !== asset.sha256)
      )
        throw new Error("DRAFT_SAVE_ASSET_CONFLICT");
      if (!existing)
        input.database
          .prepare(
            "INSERT INTO book_resources (id,book_id,storage_rel_path,size_bytes,sha256,created_at) VALUES (?,?,?,?,?,?)",
          )
          .run(
            asset.id,
            request.book_id,
            `books/${request.book_id}/${asset.path}`,
            asset.size,
            asset.sha256,
            input.nowMs,
          );
    }
    if (
      current.updated_at === request.expected_updated_at &&
      !result.noChange &&
      !result.alreadyApplied
    ) {
      renameSync(source, destination);
      const directory = openSync(draftRoot, "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    }
    input.database
      .prepare("UPDATE books SET title_cache=? WHERE id=?")
      .run(view.metadata.title, request.book_id);
    const candidates = new DraftCandidateRepository(input.database);
    let candidate: DraftCandidateRecord | null = candidates.findCurrent(
      request.book_id,
    );
    if (
      !candidate ||
      candidate.sourceUpdatedAt !== timestamp ||
      !["ready", "building"].includes(candidate.state)
    )
      candidate = candidates.createForDocument({
        bookId: request.book_id,
        importId: book.draft_import_id,
        sourceUpdatedAt: timestamp,
        nowMs: input.nowMs,
      });
    if (input.recovery)
      input.database
        .prepare(
          "UPDATE jobs SET state='succeeded',phase='complete',lease_owner=NULL,lease_until=NULL,heartbeat_at=NULL,error_class=NULL,error_code=NULL,finished_at=? WHERE id=?",
        )
        .run(input.nowMs, input.jobId);
    else
      jobs.completeSuccess({
        jobId: input.jobId,
        leaseOwner: input.leaseOwner,
        nowMs: input.nowMs,
      });
    if (!candidate) throw new Error("DRAFT_CANDIDATE_MISSING");
    input.database
      .prepare(
        "UPDATE save_draft_requests SET payload_json='{}' WHERE job_id=?",
      )
      .run(input.jobId);
    return { updated_at: timestamp, candidate_id: candidate.attemptId };
  });
}
