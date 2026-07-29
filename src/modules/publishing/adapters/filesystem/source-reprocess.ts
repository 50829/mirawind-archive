import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";

import type { TypographyProfile } from "@/modules/publishing/core/preparation/document-model";
import type { MarkdownCandidate } from "@/modules/publishing/adapters/filesystem/discover-markdown-candidates";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import {
  JobRepository,
  type JobRecord,
} from "@/modules/publishing/adapters/sqlite/jobs";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import { SafeApplicationError } from "@/domain/errors";
import { createOpaqueId } from "@/domain/ids";
import {
  resolveContainedPath,
  type StorageLayout,
} from "@/platform/filesystem/layout";

const retainedImportExpiry = Number.MAX_SAFE_INTEGER;

function preconditionFailed(): never {
  throw new SafeApplicationError(
    "REPROCESS_PRECONDITION_FAILED",
    "The draft source or configuration changed before reprocessing started.",
    409,
  );
}

function sourceUnavailable(): never {
  throw new SafeApplicationError(
    "REPROCESS_SOURCE_UNAVAILABLE",
    "The retained original source cannot be reprocessed.",
    409,
  );
}

async function digestFile(path: string): Promise<{
  readonly sha256: string;
  readonly size: number;
}> {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    hash.update(bytes);
    size += bytes.byteLength;
  }
  return Object.freeze({ sha256: hash.digest("hex"), size });
}

function clonedCandidate(
  source: ReturnType<ImportRepository["candidates"]>[number],
): MarkdownCandidate {
  const evidence = source.evidence;
  const byteSize = Number(evidence.byteSize);
  const referencedResources = Number(evidence.referencedResources);
  const companionFiles = Array.isArray(evidence.companionFiles)
    ? evidence.companionFiles.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  if (
    !Number.isSafeInteger(byteSize) ||
    byteSize < 0 ||
    !Number.isSafeInteger(referencedResources) ||
    referencedResources < 0
  ) {
    sourceUnavailable();
  }
  return Object.freeze({
    byteSize,
    companionFiles: Object.freeze(companionFiles),
    confidence: source.confidence === "high" ? "high" : "generic",
    diagnostics: source.diagnostics,
    firstHeading:
      typeof evidence.firstHeading === "string" ? evidence.firstHeading : null,
    id: createOpaqueId("candidate"),
    normalizedPath: source.normalizedPath,
    referencedResources,
    score: source.score,
  });
}

export async function queueSourceReprocess(input: {
  readonly bookId: number;
  readonly database: Database.Database;
  readonly expectedConfigRevision: number;
  readonly layout: StorageLayout;
  readonly nowMs: number;
  readonly profile: TypographyProfile;
}): Promise<{ readonly importId: string; readonly job: JobRecord }> {
  const drafts = new DraftRepository(input.database);
  const sources = new SourceRepository(input.database);
  const imports = new ImportRepository(input.database);
  const jobs = new JobRepository(input.database);
  const book = drafts.findBook(input.bookId);
  if (
    !book ||
    !book.draftSourceId ||
    book.draftConfigRevision !== input.expectedConfigRevision
  ) {
    preconditionFailed();
  }
  const source = sources.findSnapshot(book.draftSourceId);
  const original = sources.findMineruOriginal(input.bookId, book.draftSourceId);
  if (
    !source ||
    !original ||
    source.bookId !== input.bookId ||
    original.bookId !== input.bookId ||
    original.sourceId !== source.id ||
    original.role !== "mineru_zip"
  ) {
    sourceUnavailable();
  }
  const operation = `book.reprocess:${input.bookId}`;
  const idempotencyKey = [
    original.id,
    source.id,
    input.expectedConfigRevision,
    input.profile,
  ].join(":");
  const existing = jobs.findByIdempotency(operation, idempotencyKey);
  if (existing?.importId) {
    return Object.freeze({ importId: existing.importId, job: existing });
  }
  const sourceImport = imports.find(source.createdFromImportId);
  const selected =
    sourceImport?.selectedCandidateId === null ||
    sourceImport?.selectedCandidateId === undefined
      ? undefined
      : imports
          .candidates(sourceImport.id)
          .find(
            (candidate) => candidate.id === sourceImport.selectedCandidateId,
          );
  if (!selected) sourceUnavailable();
  const candidate = clonedCandidate(selected);
  const importId = createOpaqueId("import");
  const uploadRelativePath = `tmp/uploads/${importId}/original.zip`;
  const uploadPath = resolve(input.layout.root, uploadRelativePath);
  const partialPath = `${uploadPath}.part`;
  try {
    const originalPath = await resolveContainedPath(
      input.layout.root,
      original.storageRelativePath,
    );
    const metadata = await lstat(originalPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) sourceUnavailable();
    await mkdir(resolve(uploadPath, ".."), { mode: 0o700, recursive: true });
    await copyFile(originalPath, partialPath);
    await chmod(partialPath, 0o400);
    const copied = await digestFile(partialPath);
    if (
      copied.sha256 !== original.sha256 ||
      copied.size !== original.sizeBytes
    ) {
      sourceUnavailable();
    }
    await rename(partialPath, uploadPath);

    imports.createUploaded({
      bookId: input.bookId,
      expiresAtMs: retainedImportExpiry,
      id: importId,
      nowMs: input.nowMs,
      uploadRelativePath,
      uploadSha256: copied.sha256,
      uploadSizeBytes: copied.size,
    });
    imports.startAnalysis(importId, input.nowMs);
    imports.saveCandidates({
      candidates: [candidate],
      importId,
      nextState: "preparing",
      nowMs: input.nowMs,
      preparation: {
        expectedConfigRevision: input.expectedConfigRevision,
        expectedSourceId: source.id,
        kind: "reprocess",
        originalFileId: original.id,
        typographyProfile: input.profile,
      },
      selectedCandidateId: candidate.id,
    });
    const job = jobs.create({
      bookId: input.bookId,
      capturedConfigRevision: input.expectedConfigRevision,
      capturedSourceId: source.id,
      idempotency: { key: idempotencyKey, operation },
      importId,
      kind: "prepare_draft",
      nowMs: input.nowMs,
    });
    return Object.freeze({ importId, job });
  } catch (error) {
    await rm(resolve(uploadPath, ".."), { force: true, recursive: true });
    throw error;
  }
}
