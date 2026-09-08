import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { SafeDiagnostic } from "@/domain/errors";
import type { CandidateTreeCrashPointInjector } from "../../application/candidate-durability";
import {
  assembleCandidate,
  type CandidateAssemblyResult,
} from "./candidate-assembly";
import {
  finalizeCandidateTree,
  type CandidateTreeLayout,
} from "./finalize-candidate-tree";
import {
  materializeCandidatePages,
  type CandidateMaterializationResult,
} from "../reader-html/candidate-materializer";
import {
  type BuildCandidateCommand,
  type CandidateBuildArtifact,
  type CandidateBuildStageUpdate,
} from "../../application/publishing-api";
import {
  validateDocumentManifest,
  validateVersionMarker,
} from "../../core/publication/document-manifest-schema";
import {
  canonicalJson,
  compilerIdentity,
} from "../../core/publication/manifest";
import { pageMetadata } from "../../core/publication/compiled-book";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";
import { profilePipelineStage } from "@/observability/pipeline-profile";

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function boundedDiagnostics(
  diagnostics: readonly SafeDiagnostic[],
): readonly SafeDiagnostic[] {
  return Object.freeze(
    [
      ...new Map(
        diagnostics
          .slice(0, 10_000)
          .map((diagnostic) => [JSON.stringify(diagnostic), diagnostic]),
      ).values(),
    ].slice(0, 10_000),
  );
}

function candidateMaterialization(
  result: CandidateAssemblyResult,
): CandidateMaterializationResult {
  const value = result.pageMaterialization;
  if (
    !value ||
    typeof value !== "object" ||
    !Number.isSafeInteger((value as CandidateMaterializationResult).pageCount)
  ) {
    throw new Error("CANDIDATE_PAGE_MATERIALIZATION_INVALID");
  }
  return value as CandidateMaterializationResult;
}

function report(
  callback: ((update: CandidateBuildStageUpdate) => void) | undefined,
  update: CandidateBuildStageUpdate,
): void {
  callback?.(Object.freeze(update));
}

export async function buildCandidateVersion(input: {
  readonly command: BuildCandidateCommand;
  readonly crashPoint?: CandidateTreeCrashPointInjector;
  readonly createdAtMs: number;
  readonly layout: CandidateTreeLayout & { readonly root: string };
  readonly onStage?: (update: CandidateBuildStageUpdate) => void;
  readonly preparationDiagnostics: readonly SafeDiagnostic[];
  readonly signal?: AbortSignal;
}): Promise<CandidateBuildArtifact> {
  const { command } = input;
  const stagingDirectory = await resolveContainedPath(
    input.layout.root,
    `staging/${command.jobId}`,
  );
  const inputPath = await resolveContainedPath(
    input.layout.root,
    command.inputRelativePath,
  );
  const resourceRoot = await resolveContainedPath(
    input.layout.root,
    command.resourceRootRelativePath,
  );
  report(input.onStage, {
    completed: 0,
    phase: "compile_book",
    total: 1,
    unit: "steps",
  });
  let safeDiagnostics: readonly SafeDiagnostic[] = [];
  const result = await assembleCandidate({
    bookId: command.bookId,
    sourceUpdatedAt: command.sourceUpdatedAt,
    inputPath,
    documentSha256: command.documentSha256,
    createdAtMs: input.createdAtMs,
    importId: command.importId,
    async materializePages(context) {
      if (
        context.compiled.identity.compiler_version !==
          command.compilerIdentity ||
        context.compiled.identity.renderer_version !== command.rendererIdentity
      ) {
        throw new Error("CANDIDATE_IDENTITY_MISMATCH");
      }
      report(input.onStage, {
        completed: 1,
        phase: "compile_book",
        total: 1,
        unit: "steps",
      });
      report(input.onStage, {
        completed: 0,
        phase: "render_pages",
        total: context.compiled.pages.length,
        unit: "pages",
      });
      const materialized = await materializeCandidatePages({
        bookId: command.bookId,
        candidateDirectory: context.candidateDirectory,
        compiled: context.compiled,
        bookDocument: context.bookDocument,
        candidateId: command.candidateId,
        sourceUpdatedAt: command.sourceUpdatedAt,
        files: context.files,
        onPageRendered(completed, total) {
          report(input.onStage, {
            completed,
            phase: "render_pages",
            total,
            unit: "pages",
          });
        },
        onSearchFinalizing(total) {
          report(input.onStage, {
            completed: 0,
            phase: "build_search",
            total,
            unit: "items",
          });
        },
        originalFiles: context.originalFiles,
        preparationDiagnostics: input.preparationDiagnostics,
        resourceResolution: context.resourceResolution,
        ...(input.signal ? { signal: input.signal } : {}),
        versionId: command.versionId,
      });
      safeDiagnostics = boundedDiagnostics(materialized.diagnostics);
      await context.files.write(
        "preview/diagnostics.json",
        canonicalJson({ diagnostics: safeDiagnostics }),
      );
      await context.files.write(
        "preview/preview-model.json",
        canonicalJson({
          compiler_version: context.compiled.identity.compiler_version,
          boundaries: context.bookDocument.publishing.boundaries,
          candidate_id: command.candidateId,
          source_updated_at: command.sourceUpdatedAt,
          headings: context.compiled.headings.map((heading) => ({
            block_id: heading.block_id,
            display_level: heading.display_level,
            include_in_toc: heading.include_in_toc,
            number: heading.number,
            page_id: materialized.pageByHeading.get(heading.block_id) ?? null,
            source_number: heading.sourceNumber,
            exclude_from_numbering: heading.exclude_from_numbering,
            starts_page: heading.starts_page,
            title: heading.title,
            title_markdown: heading.title_markdown,
          })),
          pages: context.compiled.pages.map((page) => ({
            page_id: page.pageId,
            title: pageMetadata(context.compiled, page).title,
          })),
          renderer_version: context.compiled.identity.renderer_version,
          semantic_digest: context.compiled.identity.semantic_digest,
          version: command.previewIdentity,
        }),
      );
      await context.files.write(
        "derived/candidate.json",
        canonicalJson({
          candidate_id: command.candidateId,
          compiler_identity: command.compilerIdentity,
          preview_identity: command.previewIdentity,
          reader_identity: command.readerIdentity,
          renderer_identity: command.rendererIdentity,
          semantic_digest: context.compiled.identity.semantic_digest,
          version_id: command.versionId,
        }),
      );
      report(input.onStage, {
        completed:
          materialized.searchFtsRowCount + materialized.searchShortRowCount,
        phase: "build_search",
        total:
          materialized.searchFtsRowCount + materialized.searchShortRowCount,
        unit: "items",
      });
      return materialized;
    },
    predecessorVersionId: command.capturedCurrentVersionId,
    ...(input.signal ? { signal: input.signal } : {}),
    resourceRoot,
    stagingDirectory,
    versionId: command.versionId,
  });
  const materialized = candidateMaterialization(result);
  report(input.onStage, {
    completed: 0,
    phase: "finalize_candidate",
    total: 1,
    unit: "steps",
  });
  const finalDirectory = await profilePipelineStage("candidate_finalize", () =>
    finalizeCandidateTree({
      artifact: result,
      ...(input.crashPoint ? { crashPoint: input.crashPoint } : {}),
      layout: input.layout,
      stagingDirectory,
    }),
  );
  const [manifestBytes, markerBytes] = await Promise.all([
    readFile(resolve(finalDirectory, "document-manifest.json")),
    readFile(resolve(finalDirectory, "version.json")),
  ]);
  const manifest = validateDocumentManifest(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  const marker = validateVersionMarker(
    JSON.parse(markerBytes.toString("utf8")),
  );
  const markerCompiler = marker.compiler as Readonly<Record<string, unknown>>;
  if (
    markerCompiler.version !== command.compilerIdentity ||
    markerCompiler.renderer_version !== command.rendererIdentity ||
    result.identity.semantic_digest !==
      String(
        (
          JSON.parse(
            await readFile(
              resolve(finalDirectory, "derived/candidate.json"),
              "utf8",
            ),
          ) as Readonly<Record<string, unknown>>
        ).semantic_digest,
      ) ||
    compilerIdentity.version !== command.compilerIdentity
  ) {
    throw new Error("CANDIDATE_IDENTITY_MISMATCH");
  }
  const artifact = Object.freeze({
    artifactRootRelativePath: relative(input.layout.root, finalDirectory)
      .split(sep)
      .join("/"),
    blockingDiagnosticCount: safeDiagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    ).length,
    candidateId: command.candidateId,
    compilerIdentity: command.compilerIdentity,
    diagnosticCount: safeDiagnostics.length,
    kind: "candidate_build_artifact",
    manifestSha256: sha256(manifestBytes),
    pageCount: materialized.pageCount,
    previewIdentity: command.previewIdentity,
    readerIdentity: command.readerIdentity,
    rendererIdentity: command.rendererIdentity,
    resourceCount: Object.keys(
      manifest.resources as Readonly<Record<string, unknown>>,
    ).length,
    searchRowCount:
      materialized.searchFtsRowCount + materialized.searchShortRowCount,
    semanticDigest: result.identity.semantic_digest,
    versionId: command.versionId,
    versionMarkerSha256: sha256(markerBytes),
  } satisfies CandidateBuildArtifact);
  report(input.onStage, {
    completed: 1,
    phase: "finalize_candidate",
    total: 1,
    unit: "steps",
  });
  return artifact;
}
