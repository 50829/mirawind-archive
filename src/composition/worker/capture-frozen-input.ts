import { createHash } from "node:crypto";
import { linkSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type Database from "better-sqlite3";
import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftSaveRepository } from "@/modules/publishing/adapters/sqlite/draft-saves";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import type { UserJobRecord } from "@/modules/publishing/adapters/sqlite/jobs";
import {
  draftDocumentPath,
  requireDraftTimestamp,
} from "@/modules/publishing/adapters/filesystem/draft-document";
import { readJsonDocument } from "@/modules/publishing/adapters/filesystem/read-json-document";
import {
  serializeBookDocument,
  validateBookDocument,
} from "@/modules/publishing/core/content/book-document";
import type { FrozenJobInput } from "@/entrypoints/worker/protocol";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export async function captureFrozenJobInput(input: {
  readonly job: UserJobRecord;
  readonly candidates: DraftCandidateRepository;
  readonly imports: ImportRepository;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
}): Promise<FrozenJobInput> {
  const job = input.job;
  const common = {
    attempt: job.attempt,
    createdAtMs: job.createdAtMs,
    jobId: job.id,
    stagingRelativePath: "staging/" + job.id,
  };
  if (job.kind === "purge_book") {
    if (job.bookId === null) throw new Error("PURGE_BOOK_INPUT_INVALID");
    return { ...common, bookId: job.bookId, kind: job.kind };
  }
  if (job.kind === "analyze_import" || job.kind === "prepare_draft") {
    if (!job.importId) throw new Error("IMPORT_JOB_INPUT_INVALID");
    const imported = input.imports.require(job.importId);
    if (job.kind === "analyze_import")
      return {
        ...common,
        kind: job.kind,
        importId: imported.id,
        importUploadRelativePath: imported.uploadRelativePath,
      };
    const selected = input.imports
      .candidates(imported.id)
      .find((candidate) => candidate.id === imported.selectedCandidateId);
    if (imported.bookId === null || !selected)
      throw new Error("PREPARE_DRAFT_INPUT_INVALID");
    return {
      ...common,
      kind: job.kind,
      bookId: imported.bookId,
      importId: imported.id,
      importUploadRelativePath: imported.uploadRelativePath,
      selectedCandidateRelativePath: selected.normalizedPath,
    };
  }
  const saves = new DraftSaveRepository(input.database);
  if (job.kind === "save_draft") {
    const save = saves.require(job.id);
    const path = "staging/" + job.id + "/save-request.json";
    await atomicWriteFile(
      resolve(input.layout.root, path),
      JSON.stringify({
        patch: JSON.parse(save.payload_json),
        expected_updated_at: save.expected_updated_at,
        accepted_updated_at: save.accepted_updated_at,
        document_sha256: save.document_sha256,
        no_change: save.no_change,
        prepared_path: save.prepared_path,
      }) + "\n",
      { mode: 0o600 },
    );
    return {
      ...common,
      kind: job.kind,
      bookId: save.book_id,
      expectedUpdatedAt: save.expected_updated_at,
      requestRelativePath: path,
    };
  }
  if (job.kind === "build_candidate") {
    if (!job.candidateId) throw new Error("BUILD_CANDIDATE_INPUT_INVALID");
    const command = input.candidates.buildCommand(job.candidateId);
    const source = draftDocumentPath(input.layout, command.bookId);
    const book = validateBookDocument(
      await readJsonDocument(source),
      command.bookId,
    );
    if (book.updated_at !== command.sourceUpdatedAt)
      throw new Error("CANDIDATE_INPUT_STALE");
    const documentSha256 = createHash("sha256")
      .update(serializeBookDocument(book))
      .digest("hex");
    const draftRoot = dirname(source);
    const imported = JSON.parse(
      await readFile(resolve(draftRoot, "import-artifact.json"), "utf8"),
    ) as { sourceUpdatedAt: number; documentSha256: string };
    const expected =
      saves.acceptedDigest(command.bookId, command.sourceUpdatedAt) ??
      (imported.sourceUpdatedAt === command.sourceUpdatedAt
        ? imported.documentSha256
        : null);
    if (documentSha256 !== expected)
      throw new Error("DRAFT_DOCUMENT_INTEGRITY_MISMATCH");
    const destination = resolve(input.layout.root, command.inputRelativePath);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await atomicWriteFile(
      resolve(dirname(destination), "resources.json"),
      JSON.stringify(
        saves.resourceProof(
          command.bookId,
          book.resources.map((resource) => resource.id),
        ),
      ) + "\n",
      { mode: 0o400 },
    );
    await atomicWriteFile(
      resolve(dirname(destination), "original.json"),
      await readFile(resolve(draftRoot, "import.json")),
      { mode: 0o400 },
    );
    await atomicWriteFile(
      resolve(dirname(destination), "analysis.json"),
      await readFile(
        resolve(draftRoot, "views", String(book.updated_at), "analysis.json"),
      ),
      { mode: 0o400 },
    );
    withImmediateTransaction(input.database, () => {
      requireDraftTimestamp(
        input.layout,
        command.bookId,
        command.sourceUpdatedAt,
      );
      if (saves.pending(command.bookId))
        throw new Error("CANDIDATE_SUPERSEDED");
      try {
        linkSync(source, destination);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    });
    return { ...command, documentSha256 };
  }
  throw new Error("JOB_INPUT_KIND_INVALID");
}
