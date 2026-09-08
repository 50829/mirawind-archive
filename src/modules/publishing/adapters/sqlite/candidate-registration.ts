import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";

import type { BookVersionPresentationWriter } from "@/modules/catalog/application/catalog-api";
import { readCandidateSearchSpool } from "../filesystem/candidate-search-spool";
import { VersionRepository } from "./versions";
import { DraftSaveRepository } from "./draft-saves";
import { requireDraftTimestamp } from "../filesystem/draft-document";
import type { CandidateRegistrationPort } from "../../application/commands/finalize-candidate";
import {
  deriveBookVersionPresentation,
  type BuildCandidateCommand,
  type CandidateBuildArtifact,
} from "../../application/publishing-api";
import {
  validateDocumentManifest,
  validateVersionMarker,
} from "../../core/publication/document-manifest-schema";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface RegisteredCandidate {
  readonly candidateId: string;
  readonly semanticDigest: string;
  readonly versionId: string;
}

export type CandidateRegistrationCrashPoint =
  | "after_version_before_candidate"
  | "after_candidate_before_job"
  | "after_commit";

export type CandidateRegistrationCrashPointInjector = (
  point: CandidateRegistrationCrashPoint,
) => void;

export class CandidateRegistrationAdapter implements CandidateRegistrationPort<RegisteredCandidate> {
  constructor(
    private readonly database: Database.Database,
    private readonly layout: StorageLayout,
    private readonly presentationWriter: BookVersionPresentationWriter,
    private readonly crashPoint?: CandidateRegistrationCrashPointInjector,
  ) {}

  async register(input: {
    readonly artifact: CandidateBuildArtifact;
    readonly command: BuildCandidateCommand;
    readonly leaseOwner: string;
    readonly nowMs: number;
  }): Promise<RegisteredCandidate> {
    const candidateDirectory = await resolveContainedPath(
      this.layout.root,
      input.artifact.artifactRootRelativePath,
    );
    const [manifestBytes, markerBytes, bookDocument, spool] = await Promise.all(
      [
        readFile(resolve(candidateDirectory, "document-manifest.json")),
        readFile(resolve(candidateDirectory, "version.json")),
        readFile(resolve(candidateDirectory, "book.json"), "utf8"),
        readCandidateSearchSpool(
          resolve(candidateDirectory, "derived/search-rows.ndjson"),
        ),
      ],
    );
    if (
      sha256(manifestBytes) !== input.artifact.manifestSha256 ||
      sha256(markerBytes) !== input.artifact.versionMarkerSha256 ||
      spool.ftsRows.length + spool.shortRows.length !==
        input.artifact.searchRowCount
    ) {
      throw new Error("CANDIDATE_ARTIFACT_INTEGRITY_MISMATCH");
    }
    const manifest = validateDocumentManifest(
      JSON.parse(manifestBytes.toString("utf8")),
    );
    const marker = validateVersionMarker(
      JSON.parse(markerBytes.toString("utf8")),
    );
    const compiler = marker.compiler as Readonly<Record<string, unknown>>;
    if (
      marker.version_id !== input.command.versionId ||
      marker.book_id !== input.command.bookId ||
      marker.book_document_sha256 !== input.command.documentSha256 ||
      marker.source_updated_at !== input.command.sourceUpdatedAt ||
      marker.predecessor_version_id !==
        input.command.capturedCurrentVersionId ||
      compiler.version !== input.command.compilerIdentity ||
      compiler.renderer_version !== input.command.rendererIdentity ||
      manifest.version_id !== input.command.versionId ||
      (manifest.pages as readonly unknown[]).length !== input.artifact.pageCount
    ) {
      throw new Error("CANDIDATE_ARTIFACT_IDENTITY_MISMATCH");
    }
    const presentation = deriveBookVersionPresentation({
      bookDocument: JSON.parse(bookDocument),
      createdAtMs: input.nowMs,
      documentManifest: manifest,
    });
    const blocks = manifest.blocks as Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;

    const registered = withImmediateTransaction(this.database, () => {
      requireDraftTimestamp(
        this.layout,
        input.command.bookId,
        input.command.sourceUpdatedAt,
      );
      if (new DraftSaveRepository(this.database).pending(input.command.bookId))
        throw new Error("CANDIDATE_SUPERSEDED");
      const capture = this.database
        .prepare(
          `SELECT candidate.state AS candidate_state,
                  candidate.book_id, candidate.import_id,
                  candidate.source_updated_at, candidate.job_id,
                  candidate.version_id AS candidate_version_id,
                  candidate.semantic_digest AS candidate_semantic_digest,
                  candidate.blocking_diagnostic_count,
                  jobs.state AS job_state, jobs.lease_owner,
                  jobs.version_id AS job_version_id,
                  jobs.captured_current_version_id,
                  books.current_candidate_id, books.current_version_id,
                  books.draft_import_id
           FROM draft_candidates AS candidate
           JOIN jobs ON jobs.id = candidate.job_id
            AND jobs.candidate_id = candidate.id
           JOIN books ON books.id = candidate.book_id
           WHERE candidate.id = ? AND books.deletion_requested_at IS NULL`,
        )
        .get(input.command.candidateId) as
        | {
            book_id: number;
            blocking_diagnostic_count: number | null;
            candidate_state: string;
            candidate_semantic_digest: string | null;
            candidate_version_id: string | null;
            captured_current_version_id: string | null;
            source_updated_at: number;
            current_candidate_id: string | null;
            current_version_id: string | null;
            draft_import_id: string | null;
            job_id: string;
            job_state: string;
            job_version_id: string | null;
            lease_owner: string | null;
            import_id: string;
          }
        | undefined;
      if (!capture) throw new Error("CANDIDATE_FINALIZATION_STALE");
      const captureMismatch =
        capture.job_id !== input.command.jobId ||
        capture.job_version_id !== input.command.versionId ||
        capture.book_id !== input.command.bookId ||
        capture.import_id !== input.command.importId ||
        capture.source_updated_at !== input.command.sourceUpdatedAt ||
        capture.captured_current_version_id !==
          input.command.capturedCurrentVersionId ||
        capture.current_candidate_id !== input.command.candidateId ||
        capture.current_version_id !== input.command.capturedCurrentVersionId ||
        capture.draft_import_id !== input.command.importId;
      if (captureMismatch) {
        throw new Error("CANDIDATE_FINALIZATION_STALE");
      }
      if (
        capture.candidate_state === "ready" &&
        capture.job_state === "succeeded" &&
        capture.candidate_version_id === input.command.versionId &&
        capture.candidate_semantic_digest === input.artifact.semanticDigest &&
        capture.blocking_diagnostic_count ===
          input.artifact.blockingDiagnosticCount
      ) {
        return Object.freeze({
          candidateId: input.command.candidateId,
          semanticDigest: input.artifact.semanticDigest,
          versionId: input.command.versionId,
        });
      }
      if (
        capture.candidate_state !== "building" ||
        capture.candidate_version_id !== null ||
        capture.job_state !== "running" ||
        capture.lease_owner !== input.leaseOwner
      ) {
        throw new Error("CANDIDATE_FINALIZATION_STALE");
      }
      new VersionRepository(this.database).registerReadyWithSearch({
        blockingDiagnosticCount: input.artifact.blockingDiagnosticCount,
        bookId: input.command.bookId,
        compilerVersion: input.command.compilerIdentity,
        completeAtMs: input.nowMs,
        sourceUpdatedAt: input.command.sourceUpdatedAt,
        createdByJobId: input.command.jobId,
        expectedSearchBlockIds: Object.entries(blocks)
          .filter(([, block]) => String(block.normalized_visible_text).trim())
          .map(([blockId]) => blockId),
        manifestSchemaVersion: Number(manifest.schema_version),
        manifestSha256: input.artifact.manifestSha256,
        predecessorVersionId: input.command.capturedCurrentVersionId,
        presentation,
        presentationWriter: this.presentationWriter,
        previewVersion: input.command.previewIdentity,
        readerVersion: input.command.readerIdentity,
        rendererVersion: input.command.rendererIdentity,
        semanticDigest: input.artifact.semanticDigest,
        importId: input.command.importId,
        spool,
        versionId: input.command.versionId,
        versionMarkerSha256: input.artifact.versionMarkerSha256,
        versionRelativePath: input.artifact.artifactRootRelativePath,
      });
      this.crashPoint?.("after_version_before_candidate");
      const candidate = this.database
        .prepare(
          `UPDATE draft_candidates
           SET state = 'ready', version_id = ?, semantic_digest = ?,
               blocking_diagnostic_count = ?, completed_at = max(?, created_at)
           WHERE id = ? AND state = 'building' AND version_id IS NULL`,
        )
        .run(
          input.command.versionId,
          input.artifact.semanticDigest,
          input.artifact.blockingDiagnosticCount,
          input.nowMs,
          input.command.candidateId,
        );
      this.crashPoint?.("after_candidate_before_job");
      const job = this.database
        .prepare(
          `UPDATE jobs
           SET state = 'succeeded', phase = 'complete', progress_json = ?,
               finished_at = ?, lease_owner = NULL, lease_until = NULL,
               heartbeat_at = NULL
           WHERE id = ? AND candidate_id = ? AND state = 'running'
             AND lease_owner = ?`,
        )
        .run(
          JSON.stringify({
            completed: 1,
            processed_bytes: null,
            total: 1,
            unit: "steps",
          }),
          input.nowMs,
          input.command.jobId,
          input.command.candidateId,
          input.leaseOwner,
        );
      if (candidate.changes !== 1 || job.changes !== 1) {
        throw new Error("CANDIDATE_READY_REGISTRATION_CONFLICT");
      }
      return Object.freeze({
        candidateId: input.command.candidateId,
        semanticDigest: input.artifact.semanticDigest,
        versionId: input.command.versionId,
      });
    });
    this.crashPoint?.("after_commit");
    return registered;
  }
}
