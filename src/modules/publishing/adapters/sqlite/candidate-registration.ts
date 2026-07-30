import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type Database from "better-sqlite3";

import { deriveBookVersionPresentation } from "@/modules/catalog/application/public";
import { readCandidateSearchSpool } from "@/modules/publishing/adapters/filesystem/candidate-search-spool";
import { VersionRepository } from "@/modules/publishing/adapters/sqlite/versions";
import type { CandidateRegistrationPort } from "@/modules/publishing/application/commands/finalize-candidate";
import type {
  BuildCandidateCommand,
  CandidateBuildArtifact,
} from "@/modules/publishing/application/public";
import {
  validateDocumentManifest,
  validateVersionMarker,
} from "@/modules/publishing/core/publication/document-manifest-schema";
import type { StorageLayout } from "@/platform/filesystem/layout";
import { resolveContainedPath } from "@/platform/filesystem/layout";
import { withImmediateTransaction } from "@/platform/sqlite/immediate-transaction";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface RegisteredCandidate {
  readonly candidateId: string;
  readonly semanticDigest: string;
  readonly versionId: string;
}

export class CandidateRegistrationAdapter
  implements CandidateRegistrationPort<RegisteredCandidate>
{
  constructor(
    private readonly database: Database.Database,
    private readonly layout: StorageLayout,
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
    const [manifestBytes, markerBytes, bookConfig, spool] = await Promise.all([
      readFile(resolve(candidateDirectory, "document-manifest.json")),
      readFile(resolve(candidateDirectory, "version.json")),
      readFile(resolve(candidateDirectory, "book.yaml"), "utf8"),
      readCandidateSearchSpool(
        resolve(candidateDirectory, "derived/search-rows.ndjson"),
      ),
    ]);
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
    const marker = validateVersionMarker(JSON.parse(markerBytes.toString("utf8")));
    const compiler = marker.compiler as Readonly<Record<string, unknown>>;
    if (
      marker.version_id !== input.command.versionId ||
      marker.book_id !== input.command.bookId ||
      marker.source_id !== input.command.sourceId ||
      marker.config_revision !== input.command.configRevision ||
      marker.predecessor_version_id !== input.command.capturedCurrentVersionId ||
      compiler.version !== input.command.compilerIdentity ||
      compiler.renderer_version !== input.command.rendererIdentity ||
      manifest.version_id !== input.command.versionId ||
      (manifest.pages as readonly unknown[]).length !==
        input.artifact.pageCount
    ) {
      throw new Error("CANDIDATE_ARTIFACT_IDENTITY_MISMATCH");
    }
    const presentation = deriveBookVersionPresentation({
      bookConfig,
      createdAtMs: input.nowMs,
      documentManifest: manifest,
    });
    const blocks = manifest.blocks as Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;

    return withImmediateTransaction(this.database, () => {
      const capture = this.database
        .prepare(
          `SELECT candidate.state AS candidate_state,
                  candidate.book_id, candidate.source_id,
                  candidate.config_revision, candidate.job_id,
                  jobs.state AS job_state, jobs.lease_owner,
                  jobs.version_id AS job_version_id,
                  jobs.captured_current_version_id,
                  books.current_candidate_id, books.current_version_id,
                  books.draft_source_id, books.draft_config_revision
           FROM draft_candidates AS candidate
           JOIN jobs ON jobs.id = candidate.job_id
            AND jobs.candidate_id = candidate.id
           JOIN books ON books.id = candidate.book_id
           WHERE candidate.id = ? AND books.deletion_requested_at IS NULL`,
        )
        .get(input.command.candidateId) as
        | {
            book_id: number;
            candidate_state: string;
            captured_current_version_id: string | null;
            config_revision: number;
            current_candidate_id: string | null;
            current_version_id: string | null;
            draft_config_revision: number | null;
            draft_source_id: string | null;
            job_id: string;
            job_state: string;
            job_version_id: string | null;
            lease_owner: string | null;
            source_id: string;
          }
        | undefined;
      if (
        !capture ||
        capture.candidate_state !== "building" ||
        capture.job_state !== "running" ||
        capture.lease_owner !== input.leaseOwner ||
        capture.job_id !== input.command.jobId ||
        capture.job_version_id !== input.command.versionId ||
        capture.book_id !== input.command.bookId ||
        capture.source_id !== input.command.sourceId ||
        capture.config_revision !== input.command.configRevision ||
        capture.captured_current_version_id !==
          input.command.capturedCurrentVersionId ||
        capture.current_candidate_id !== input.command.candidateId ||
        capture.current_version_id !== input.command.capturedCurrentVersionId ||
        capture.draft_source_id !== input.command.sourceId ||
        capture.draft_config_revision !== input.command.configRevision
      ) {
        throw new Error("CANDIDATE_FINALIZATION_STALE");
      }
      new VersionRepository(this.database).registerReadyWithSearch({
        blockingDiagnosticCount: input.artifact.blockingDiagnosticCount,
        bookId: input.command.bookId,
        compilerVersion: input.command.compilerIdentity,
        completeAtMs: input.nowMs,
        configRevision: input.command.configRevision,
        createdByJobId: input.command.jobId,
        expectedSearchBlockIds: Object.entries(blocks)
          .filter(([, block]) => String(block.normalized_visible_text).trim())
          .map(([blockId]) => blockId),
        manifestSchemaVersion: Number(manifest.schema_version),
        manifestSha256: input.artifact.manifestSha256,
        predecessorVersionId: input.command.capturedCurrentVersionId,
        presentation,
        previewVersion: input.command.previewIdentity,
        readerVersion: input.command.readerIdentity,
        rendererVersion: input.command.rendererIdentity,
        semanticDigest: input.artifact.semanticDigest,
        sourceId: input.command.sourceId,
        spool,
        versionId: input.command.versionId,
        versionMarkerSha256: input.artifact.versionMarkerSha256,
        versionRelativePath: input.artifact.artifactRootRelativePath,
      });
      const candidate = this.database
        .prepare(
          `UPDATE draft_candidates
           SET state = 'ready', version_id = ?, semantic_digest = ?,
               blocking_diagnostic_count = ?, completed_at = ?
           WHERE id = ? AND state = 'building' AND version_id IS NULL`,
        )
        .run(
          input.command.versionId,
          input.artifact.semanticDigest,
          input.artifact.blockingDiagnosticCount,
          input.nowMs,
          input.command.candidateId,
        );
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
  }
}
