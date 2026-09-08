import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import type Database from "better-sqlite3";

import { DraftCandidateRepository } from "../sqlite/draft-candidate-repository";
import { ImportRepository } from "../sqlite/imports";
import {
  readPreparedDraftArtifact,
  type PreparedDraftArtifact,
} from "./prepared-draft-artifact";
import { readDraftHeader } from "../filesystem/draft-document";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

export async function finalizePreparedDraft(input: {
  readonly artifact: PreparedDraftArtifact;
  readonly database: Database.Database;
  readonly preparedRoot: string;
  readonly importId: string;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}) {
  const imports = new ImportRepository(input.database);
  const imported = imports.require(input.importId);
  if (
    imported.bookId !== input.artifact.bookId ||
    !["preparing", "draft_ready"].includes(imported.state)
  )
    throw new Error("IMPORT_PREPARE_STATE_CONFLICT");
  const finalRoot = resolve(
    input.layout.bookDirectory,
    String(input.artifact.bookId),
  );
  let artifact = input.artifact;
  const existing = await readFile(
    resolve(finalRoot, "draft/import.json"),
    "utf8",
  ).catch(() => null);
  if (existing !== null) {
    const original = JSON.parse(existing) as { import_id: string };
    if (original.import_id !== imported.id)
      throw new Error("IMPORT_BOOK_STORAGE_EXISTS");
    artifact = await readPreparedDraftArtifact(
      resolve(finalRoot, "draft/import-artifact.json"),
    );
  } else {
    if (
      artifact.original.sha256 !== imported.uploadSha256 ||
      artifact.original.size !== imported.uploadSizeBytes
    )
      throw new Error("IMPORT_ORIGINAL_INTEGRITY_MISMATCH");
    const documentPath = resolve(input.preparedRoot, "draft/book.json");
    const header = readDraftHeader(documentPath, artifact.bookId);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(documentPath))
      hash.update(chunk);
    if (
      header.updated_at !== artifact.sourceUpdatedAt ||
      hash.digest("hex") !== artifact.documentSha256
    )
      throw new Error("IMPORT_DOCUMENT_INTEGRITY_MISMATCH");
    await atomicWriteFile(
      resolve(input.preparedRoot, "draft/import.json"),
      JSON.stringify({
        import_id: imported.id,
        files: [
          {
            id: artifact.original.id,
            filename: imported.originalName,
            media_type: "application/zip",
            size: artifact.original.size,
            sha256: artifact.original.sha256,
            path: "originals/" + artifact.original.id,
          },
        ],
      }) + "\n",
      { mode: 0o600 },
    );
    await atomicWriteFile(
      resolve(input.preparedRoot, "draft/import-artifact.json"),
      JSON.stringify(artifact) + "\n",
      { mode: 0o600 },
    );
    const originalHandle = await open(
      resolve(input.preparedRoot, "originals", artifact.original.id),
      "r",
    );
    try {
      await originalHandle.sync();
    } finally {
      await originalHandle.close();
    }
    await mkdir(dirname(finalRoot), { recursive: true, mode: 0o700 });
    await rename(input.preparedRoot, finalRoot);
    const parent = await open(dirname(finalRoot), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }
  const candidates = new DraftCandidateRepository(input.database);
  const candidate = withImmediateTransaction(input.database, () => {
    const current = imports.require(imported.id);
    if (current.state === "draft_ready") {
      const existingCandidate = candidates.findCurrent(artifact.bookId);
      if (!existingCandidate) throw new Error("IMPORT_CANDIDATE_MISSING");
      return existingCandidate;
    }
    const relativePath = (path: string) =>
      relative(input.layout.root, path).split(sep).join("/");
    const insertResource = input.database.prepare(
      "INSERT INTO book_resources (id,book_id,storage_rel_path,size_bytes,sha256,created_at) VALUES (?,?,?,?,?,?)",
    );
    for (const resource of artifact.resources)
      insertResource.run(
        resource.id,
        artifact.bookId,
        relativePath(resolve(finalRoot, resource.path)),
        resource.size,
        resource.sha256,
        input.nowMs,
      );
    input.database
      .prepare(
        "INSERT INTO original_files (id,book_id,import_id,role,storage_rel_path,original_name,media_type,size_bytes,sha256,created_at) VALUES (?,?,?,'mineru_zip',?,?,'application/zip',?,?,?)",
      )
      .run(
        artifact.original.id,
        artifact.bookId,
        imported.id,
        relativePath(resolve(finalRoot, "originals", artifact.original.id)),
        imported.originalName,
        artifact.original.size,
        artifact.original.sha256,
        input.nowMs,
      );
    input.database
      .prepare(
        "UPDATE books SET title_cache = ? WHERE id = ? AND deletion_requested_at IS NULL",
      )
      .run(artifact.title, artifact.bookId);
    const candidate = candidates.createForDocument({
      bookId: artifact.bookId,
      importId: imported.id,
      sourceUpdatedAt: artifact.sourceUpdatedAt,
      nowMs: input.nowMs,
    });
    imports.attachPreparedBook({
      bookId: artifact.bookId,
      importId: imported.id,
      nowMs: input.nowMs,
    });
    return candidate;
  });
  return {
    bookId: artifact.bookId,
    sourceUpdatedAt: artifact.sourceUpdatedAt,
    candidate,
  };
}
