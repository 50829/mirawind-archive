import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import { BookPresentationRepository } from "../db/repositories/book-presentations.js";
import {
  type BookVersionRecord,
  VersionRepository,
} from "../db/repositories/versions.js";
import { withImmediateTransaction } from "../db/transaction/immediate.js";
import { validateVersionMarker } from "../schemas/document-manifest.js";
import { resolveContainedPath, type StorageLayout } from "../storage/layout.js";

export type VersionVerificationCode =
  | "VERSION_DIRECTORY_INVALID"
  | "VERSION_FILE_CLOSURE_MISMATCH"
  | "VERSION_FILE_INTEGRITY_MISMATCH"
  | "VERSION_IDENTITY_MISMATCH"
  | "VERSION_MARKER_INVALID"
  | "VERSION_REQUIRED_FILE_INVALID";

export type VersionVerificationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ code: VersionVerificationCode; ok: false }>;

interface DeclaredFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

interface CheckedMarker {
  readonly directory: string;
  readonly files: readonly DeclaredFile[];
}

async function digest(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

function failureCode(error: unknown): VersionVerificationCode {
  if (error instanceof Error) {
    if (
      error.message.includes("SCHEMA") ||
      error.message.includes("MARKER") ||
      error.name.includes("Schema") ||
      error.name.includes("Semantic")
    ) {
      return "VERSION_MARKER_INVALID";
    }
    if (error.message.includes("IDENTITY")) {
      return "VERSION_IDENTITY_MISMATCH";
    }
    if (error.message.includes("CLOSURE")) {
      return "VERSION_FILE_CLOSURE_MISMATCH";
    }
    if (error.message.includes("INTEGRITY")) {
      return "VERSION_FILE_INTEGRITY_MISMATCH";
    }
    if (error.message.includes("REQUIRED")) {
      return "VERSION_REQUIRED_FILE_INVALID";
    }
  }
  return "VERSION_DIRECTORY_INVALID";
}

async function regularFile(path: string, size: number): Promise<void> {
  const metadata = await lstat(path);
  if (
    metadata.isSymbolicLink() ||
    !metadata.isFile() ||
    metadata.size !== size
  ) {
    throw new Error("VERSION_REQUIRED_FILE_INVALID");
  }
}

async function checkMarker(
  layout: StorageLayout,
  version: BookVersionRecord,
): Promise<CheckedMarker> {
  const expectedRelativePath = `books/${version.bookId}/versions/${version.id}`;
  if (version.versionRelativePath !== expectedRelativePath) {
    throw new Error("VERSION_IDENTITY_MISMATCH");
  }
  const directory = await resolveContainedPath(
    layout.root,
    version.versionRelativePath,
  );
  const directoryMetadata = await lstat(directory);
  if (directoryMetadata.isSymbolicLink() || !directoryMetadata.isDirectory()) {
    throw new Error("VERSION_DIRECTORY_INVALID");
  }
  const markerPath = resolve(directory, "version.json");
  const markerMetadata = await lstat(markerPath);
  if (
    markerMetadata.isSymbolicLink() ||
    !markerMetadata.isFile() ||
    markerMetadata.size > 16 * 1024 * 1024
  ) {
    throw new Error("VERSION_MARKER_INVALID");
  }
  const marker = validateVersionMarker(
    JSON.parse(await readFile(markerPath, "utf8")) as unknown,
  );
  if (
    marker.book_id !== version.bookId ||
    marker.version_id !== version.id ||
    marker.source_id !== version.sourceId ||
    marker.config_revision !== version.configRevision ||
    marker.predecessor_version_id !== version.predecessorVersionId ||
    marker.manifest_sha256 !== version.manifestSha256 ||
    (marker.compiler as Readonly<Record<string, unknown>>).version !==
      version.compilerVersion ||
    (marker.compiler as Readonly<Record<string, unknown>>).renderer_version !==
      version.rendererVersion
  ) {
    throw new Error("VERSION_IDENTITY_MISMATCH");
  }
  const files = (
    marker.files as readonly Readonly<Record<string, unknown>>[]
  ).map((file) =>
    Object.freeze({
      path: String(file.path),
      sha256: String(file.sha256),
      size: Number(file.size),
    }),
  );
  return Object.freeze({ directory, files: Object.freeze(files) });
}

export async function verifyVersionQuickly(
  layout: StorageLayout,
  version: BookVersionRecord,
): Promise<VersionVerificationResult> {
  try {
    const checked = await checkMarker(layout, version);
    const byPath = new Map(checked.files.map((file) => [file.path, file]));
    const authorities = ["book.yaml", "document-manifest.json"] as const;
    for (const path of authorities) {
      const declared = byPath.get(path);
      if (!declared) throw new Error("VERSION_REQUIRED_FILE_INVALID");
      const target = resolve(checked.directory, path);
      await regularFile(target, declared.size);
      if ((await digest(target)) !== declared.sha256) {
        throw new Error("VERSION_FILE_INTEGRITY_MISMATCH");
      }
    }
    const firstPage = checked.files.find((file) =>
      /^published\/pages\/[^/]+\.html$/u.test(file.path),
    );
    if (!firstPage) throw new Error("VERSION_REQUIRED_FILE_INVALID");
    await regularFile(
      resolve(checked.directory, firstPage.path),
      firstPage.size,
    );
    return Object.freeze({ ok: true });
  } catch (error) {
    return Object.freeze({ code: failureCode(error), ok: false });
  }
}

export async function verifyVersionFully(
  layout: StorageLayout,
  version: BookVersionRecord,
): Promise<VersionVerificationResult> {
  try {
    const checked = await checkMarker(layout, version);
    const actual = new Map<
      string,
      { readonly sha256: string; readonly size: number }
    >();
    const visit = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const child = resolve(directory, entry.name);
        if (entry.isSymbolicLink())
          throw new Error("VERSION_DIRECTORY_INVALID");
        if (entry.isDirectory()) await visit(child);
        else if (entry.isFile()) {
          const path = relative(checked.directory, child).split(sep).join("/");
          if (path !== "version.json") {
            const metadata = await lstat(child);
            actual.set(path, {
              sha256: await digest(child),
              size: metadata.size,
            });
          }
        } else {
          throw new Error("VERSION_DIRECTORY_INVALID");
        }
        if (actual.size > 1_000_000) {
          throw new Error("VERSION_FILE_CLOSURE_MISMATCH");
        }
      }
    };
    await visit(checked.directory);
    if (actual.size !== checked.files.length) {
      throw new Error("VERSION_FILE_CLOSURE_MISMATCH");
    }
    for (const file of checked.files) {
      const found = actual.get(file.path);
      if (!found || found.size !== file.size || found.sha256 !== file.sha256) {
        throw new Error("VERSION_FILE_INTEGRITY_MISMATCH");
      }
    }
    return Object.freeze({ ok: true });
  } catch (error) {
    return Object.freeze({ code: failureCode(error), ok: false });
  }
}

export interface CurrentVersionRecovery {
  readonly bookId: number;
  readonly failedVersionId: string;
  readonly replacementVersionId: string | null;
}

export async function verifyAndRecoverCurrentVersions(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
  readonly presentationIntegrityFailures?: readonly string[];
}): Promise<readonly CurrentVersionRecovery[]> {
  const versions = new VersionRepository(input.database);
  const presentations = new BookPresentationRepository(input.database);
  const presentationIntegrityFailures = new Set(
    input.presentationIntegrityFailures ?? [],
  );
  const books = input.database
    .prepare(
      `SELECT id, current_version_id FROM books
       WHERE current_version_id IS NOT NULL
       ORDER BY id`,
    )
    .all() as { id: number; current_version_id: string }[];
  const recovered: CurrentVersionRecovery[] = [];
  for (const book of books) {
    const current = versions.find(book.current_version_id);
    const currentPresentation = presentations.find(book.current_version_id);
    const result =
      current &&
      current.state !== "corrupt" &&
      !presentationIntegrityFailures.has(current.id) &&
      currentPresentation &&
      currentPresentation.bookId === book.id &&
      currentPresentation.configRevision === current.configRevision
        ? await verifyVersionQuickly(input.layout, current)
        : ({ code: "VERSION_IDENTITY_MISMATCH", ok: false } as const);
    if (result.ok) continue;

    const candidates = versions
      .listForBook(book.id)
      .filter(
        (candidate) =>
          candidate.id !== book.current_version_id &&
          candidate.state === "superseded" &&
          candidate.publishedAtMs !== null &&
          candidate.verifiedAtMs !== null &&
          candidate.reclaimedAtMs === null,
      )
      .sort(
        (left, right) => (right.publishedAtMs ?? 0) - (left.publishedAtMs ?? 0),
      );
    let replacement: BookVersionRecord | null = null;
    for (const candidate of candidates) {
      const candidatePresentation = presentations.find(candidate.id);
      if (
        presentationIntegrityFailures.has(candidate.id) ||
        !candidatePresentation ||
        candidatePresentation.bookId !== candidate.bookId ||
        candidatePresentation.configRevision !== candidate.configRevision
      ) {
        continue;
      }
      const candidateResult = await verifyVersionQuickly(
        input.layout,
        candidate,
      );
      if (candidateResult.ok) {
        replacement = candidate;
        break;
      }
      versions.markCorrupt(candidate.id);
    }

    withImmediateTransaction(input.database, () => {
      if (current) versions.markCorrupt(current.id);
      if (replacement) {
        const promoted = input.database
          .prepare(
            `UPDATE book_versions
             SET state = 'published', verified_at = ?
             WHERE id = ? AND book_id = ? AND state = 'superseded'`,
          )
          .run(input.nowMs, replacement.id, book.id);
        if (promoted.changes !== 1) {
          throw new Error("VERSION_ROLLBACK_PROMOTION_FAILED");
        }
        input.database
          .prepare(
            `UPDATE books
             SET current_version_id = ?, alias = ?,
                 unavailable_reason = NULL,
                 updated_at = ?
             WHERE id = ? AND current_version_id = ?`,
          )
          .run(
            replacement.id,
            presentations.require(replacement.id).alias,
            input.nowMs,
            book.id,
            book.current_version_id,
          );
      } else {
        input.database
          .prepare(
            `UPDATE books
             SET unavailable_reason = 'CURRENT_VERSION_CORRUPT',
                 updated_at = ?
             WHERE id = ? AND current_version_id = ?`,
          )
          .run(input.nowMs, book.id, book.current_version_id);
      }
      input.database
        .prepare(
          `INSERT INTO audit_events (
             actor_user_id, action, book_id, version_id, job_id,
             safe_metadata_json, created_at
           ) VALUES (NULL, 'book.version.recovered', ?, ?, NULL, ?, ?)`,
        )
        .run(
          book.id,
          replacement?.id ?? book.current_version_id,
          JSON.stringify({
            failed_version_id: book.current_version_id,
            replacement_version_id: replacement?.id ?? null,
          }),
          input.nowMs,
        );
    });
    recovered.push(
      Object.freeze({
        bookId: book.id,
        failedVersionId: book.current_version_id,
        replacementVersionId: replacement?.id ?? null,
      }),
    );
  }
  return Object.freeze(recovered);
}
