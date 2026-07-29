import { describe, expect, it } from "vitest";

import { createOpaqueId } from "@/domain/ids";
import {
  candidateJobChildProtocolVersion,
  parseBuildCandidateChildMessage,
  parseBuildCandidateRunMessage,
} from "@/entrypoints/worker/protocol";
import {
  parseBuildCandidateCommand,
  parseCandidateBuildArtifact,
} from "@/modules/publishing/application/commands/build-candidate";

function fixture() {
  const bookId = 7;
  const candidateId = createOpaqueId("candidate");
  const jobId = createOpaqueId("job");
  const sourceId = createOpaqueId("source");
  const versionId = createOpaqueId("version");
  const command = {
    bookId,
    candidateId,
    capturedCurrentVersionId: null,
    compilerIdentity: "compiler-v5",
    configRelativePath: `books/${bookId}/draft/configs/3/book.yaml`,
    configRevision: 3,
    jobId,
    kind: "build_candidate",
    previewIdentity: "draft-preview-v5",
    readerIdentity: "mirawind-reader-v2-tailwind-4.3.3",
    rendererIdentity: "semantic-html-v5-katex-0.18.1",
    sourceId,
    sourceRootRelativePath: `books/${bookId}/draft/sources/${sourceId}`,
    versionId,
  } as const;
  const artifact = {
    artifactRootRelativePath: `books/${bookId}/versions/${versionId}`,
    blockingDiagnosticCount: 0,
    candidateId,
    compilerIdentity: command.compilerIdentity,
    diagnosticCount: 4,
    kind: "candidate_build_artifact",
    manifestSha256: "a".repeat(64),
    pageCount: 500,
    previewIdentity: command.previewIdentity,
    readerIdentity: command.readerIdentity,
    rendererIdentity: command.rendererIdentity,
    resourceCount: 120,
    searchRowCount: 12_000,
    semanticDigest: "b".repeat(64),
    versionId,
    versionMarkerSha256: "c".repeat(64),
  } as const;
  return { artifact, command };
}

describe("build candidate protocol values", () => {
  it("accepts one closed command bound to the captured book revision", () => {
    const { command } = fixture();

    expect(parseBuildCandidateCommand(command)).toEqual(command);
    expect(() =>
      parseBuildCandidateCommand({ ...command, markdown: "private body" }),
    ).toThrow("BUILD_CANDIDATE_COMMAND_INVALID");
    expect(() =>
      parseBuildCandidateCommand({
        ...command,
        sourceRootRelativePath: "../../escape",
      }),
    ).toThrow("BUILD_CANDIDATE_COMMAND_INVALID");
  });

  it("accepts one bounded artifact and rejects unknown or mismatched output", () => {
    const { artifact, command } = fixture();
    const parsedCommand = parseBuildCandidateCommand(command);

    expect(parseCandidateBuildArtifact(artifact, parsedCommand)).toEqual(
      artifact,
    );
    for (const invalid of [
      { ...artifact, html: "<main>private</main>" },
      { ...artifact, pageCount: Number.POSITIVE_INFINITY },
      { ...artifact, blockingDiagnosticCount: 5 },
      { ...artifact, versionId: createOpaqueId("version") },
      { ...artifact, compilerIdentity: "compiler-v4" },
      { ...artifact, artifactRootRelativePath: "../../escape" },
    ]) {
      expect(() => parseCandidateBuildArtifact(invalid, parsedCommand)).toThrow(
        "CANDIDATE_BUILD_ARTIFACT_INVALID",
      );
    }
  });

  it("accepts only protocol v3 candidate run and bounded child messages", () => {
    const { artifact, command } = fixture();
    const run = {
      input: command,
      protocolVersion: candidateJobChildProtocolVersion,
      type: "run",
    } as const;
    expect(parseBuildCandidateRunMessage(run)).toEqual(run);
    for (const invalid of [
      { ...run, protocolVersion: 2 },
      { ...run, legacy: true },
      {
        ...run,
        input: {
          attempt: 1,
          createdAtMs: 1,
          jobId: command.jobId,
          kind: "build_preview",
          stagingRelativePath: `staging/${command.jobId}`,
        },
      },
    ]) {
      expect(() => parseBuildCandidateRunMessage(invalid)).toThrow(
        "BUILD_CANDIDATE_RUN_MESSAGE_INVALID",
      );
    }

    const progress = {
      jobId: command.jobId,
      phase: "render_pages",
      progress: {
        completed: 20,
        processed_bytes: null,
        total: 500,
        unit: "pages",
      },
      protocolVersion: candidateJobChildProtocolVersion,
      type: "progress",
    } as const;
    expect(parseBuildCandidateChildMessage(progress, command)).toEqual(
      progress,
    );
    expect(
      parseBuildCandidateChildMessage(
        {
          jobId: command.jobId,
          ok: true,
          protocolVersion: candidateJobChildProtocolVersion,
          result: artifact,
          type: "result",
        },
        command,
      ),
    ).toMatchObject({ ok: true, result: artifact });
    expect(
      parseBuildCandidateChildMessage(
        {
          jobId: command.jobId,
          ok: false,
          protocolVersion: candidateJobChildProtocolVersion,
          safeErrorClass: "content",
          safeErrorCode: "CANDIDATE_BUILD_FAILED",
          type: "result",
        },
        command,
      ),
    ).toMatchObject({ ok: false, safeErrorCode: "CANDIDATE_BUILD_FAILED" });
    for (const invalid of [
      { ...progress, phase: "build_preview" },
      { ...progress, privateBody: "secret" },
      {
        jobId: command.jobId,
        ok: false,
        protocolVersion: candidateJobChildProtocolVersion,
        safeErrorClass: "content",
        safeErrorCode: "contains private detail",
        type: "result",
      },
    ]) {
      expect(() => parseBuildCandidateChildMessage(invalid, command)).toThrow(
        "BUILD_CANDIDATE_CHILD_MESSAGE_INVALID",
      );
    }
  });
});
