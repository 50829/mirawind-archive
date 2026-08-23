import { DraftCandidateRepository } from "@/modules/publishing/adapters/sqlite/draft-candidate-repository";
import { DraftRepository } from "@/modules/publishing/adapters/sqlite/drafts";
import { ImportRepository } from "@/modules/publishing/adapters/sqlite/imports";
import type { JobRecord } from "@/modules/publishing/adapters/sqlite/jobs";
import { SourceRepository } from "@/modules/publishing/adapters/sqlite/sources";
import type { FrozenJobInput } from "@/entrypoints/worker/protocol";

export function captureFrozenJobInput(
  job: JobRecord,
  candidates: DraftCandidateRepository,
  drafts: DraftRepository,
  imports: ImportRepository,
  sources: SourceRepository,
): FrozenJobInput {
  const imported =
    (job.kind === "analyze_import" || job.kind === "prepare_draft") &&
    job.importId
      ? imports.require(job.importId)
      : null;
  const selectedCandidate = imported?.selectedCandidateId
    ? imports
        .candidates(imported.id)
        .find((candidate) => candidate.id === imported.selectedCandidateId)
    : null;
  const preparation =
    selectedCandidate?.evidence.preparation &&
    typeof selectedCandidate.evidence.preparation === "object"
      ? (selectedCandidate.evidence.preparation as Readonly<
          Record<string, unknown>
        >)
      : null;
  const typographyProfile =
    preparation?.kind === "reprocess" &&
    (preparation.typographyProfile === "verbatim-v1" ||
      preparation.typographyProfile === "zh-smart-v2")
      ? preparation.typographyProfile
      : null;
  const source = job.capturedSourceId
    ? sources.requireSnapshot(job.capturedSourceId)
    : null;
  const config =
    job.bookId && job.capturedConfigRevision
      ? drafts.requireConfig(job.bookId, job.capturedConfigRevision)
      : null;
  const common = Object.freeze({
    attempt: job.attempt,
    createdAtMs: job.createdAtMs,
    jobId: job.id,
    stagingRelativePath: `staging/${job.id}`,
  });
  if (job.kind === "reconcile" || job.kind === "reclaim_versions") {
    return Object.freeze({ ...common, kind: job.kind });
  }
  if (job.kind === "purge_book") {
    if (job.bookId === null) throw new Error("PURGE_BOOK_INPUT_INVALID");
    return Object.freeze({ ...common, bookId: job.bookId, kind: job.kind });
  }
  if (job.kind === "verify_version") {
    if (!job.versionId) throw new Error("VERIFY_VERSION_INPUT_INVALID");
    return Object.freeze({
      ...common,
      kind: job.kind,
      versionId: job.versionId,
    });
  }
  if (job.kind === "analyze_import") {
    if (!imported || !job.importId)
      throw new Error("ANALYZE_IMPORT_INPUT_INVALID");
    return Object.freeze({
      ...common,
      importId: job.importId,
      importUploadRelativePath: imported.uploadRelativePath,
      kind: job.kind,
    });
  }
  if (job.kind === "prepare_draft") {
    const bookId = imported?.bookId ?? job.bookId;
    if (!imported || !job.importId || !bookId || !selectedCandidate) {
      throw new Error("PREPARE_DRAFT_INPUT_INVALID");
    }
    return Object.freeze({
      ...common,
      bookId,
      capturedConfigRevision: typographyProfile
        ? job.capturedConfigRevision
        : null,
      capturedSourceId: typographyProfile ? job.capturedSourceId : null,
      configYamlRelativePath: typographyProfile
        ? (config?.yamlRelativePath ?? null)
        : null,
      importId: job.importId,
      importUploadRelativePath: imported.uploadRelativePath,
      kind: job.kind,
      selectedCandidateRelativePath: selectedCandidate.normalizedPath,
      sourceRootRelativePath: typographyProfile
        ? (source?.sourceRootRelativePath ?? null)
        : null,
      ...(typographyProfile ? { typographyProfile } : {}),
    });
  }
  if (job.kind === "build_candidate") {
    if (!job.candidateId) throw new Error("BUILD_CANDIDATE_INPUT_INVALID");
    return candidates.buildCommand(job.candidateId);
  }
  throw new Error("JOB_INPUT_KIND_INVALID");
}
