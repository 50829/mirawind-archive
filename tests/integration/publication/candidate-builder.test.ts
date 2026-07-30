import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";

import { stringify } from "yaml";
import { describe, expect, it } from "vitest";

import { handleBuildCandidate } from "@/entrypoints/worker/handlers/build-candidate";
import type { BuildCandidateProgressMessage } from "@/entrypoints/worker/protocol";
import { buildCandidateVersion } from "@/modules/publishing/adapters/filesystem/build-candidate-version";
import {
  candidateBuildIdentities,
  parseBuildCandidateCommand,
  type BuildCandidateCommand,
} from "@/modules/publishing/application/public";
import {
  validateDocumentManifest,
  validateVersionMarker,
} from "@/modules/publishing/core/publication/document-manifest-schema";

import {
  createTemporaryDataRoot,
  type TemporaryDataRoot,
} from "../../helpers/data-root.js";

const bookId = 9;
const configRevision = 3;
const createdAtMs = 1_753_315_200_000;
const headingIds = [
  "blk_candidate_builder_heading_0001",
  "blk_candidate_builder_heading_0002",
] as const;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function commandFor(suffix: string): BuildCandidateCommand {
  const sourceId = `src_candidate_builder_${suffix}`;
  return parseBuildCandidateCommand({
    bookId,
    candidateId: `candidate_candidate_builder_${suffix}`,
    capturedCurrentVersionId: null,
    compilerIdentity: candidateBuildIdentities.compiler,
    configRelativePath: `books/${bookId}/draft/configs/${configRevision}/book.yaml`,
    configRevision,
    jobId: `job_candidate_builder_${suffix}`,
    kind: "build_candidate",
    previewIdentity: candidateBuildIdentities.preview,
    readerIdentity: candidateBuildIdentities.reader,
    rendererIdentity: candidateBuildIdentities.renderer,
    sourceId,
    sourceRootRelativePath: `books/${bookId}/draft/sources/${sourceId}`,
    versionId: `ver_candidate_builder_${suffix}`,
  });
}

async function writeCandidateInput(
  dataRoot: TemporaryDataRoot,
  command: BuildCandidateCommand,
): Promise<void> {
  const markdown = [
    "# First chapter",
    "",
    "Body with `code/path.ts` and $x + y$.",
    "",
    "# Second chapter",
    "",
    "Final body.",
  ].join("\n");
  const markdownSha256 = sha256(markdown);
  const sourceRoot = resolve(dataRoot.path, command.sourceRootRelativePath);
  const configPath = resolve(dataRoot.path, command.configRelativePath);
  await Promise.all([
    mkdir(sourceRoot, { mode: 0o700, recursive: true }),
    mkdir(resolve(configPath, ".."), { mode: 0o700, recursive: true }),
  ]);
  await writeFile(resolve(sourceRoot, "book.md"), markdown, { mode: 0o400 });
  await writeFile(
    configPath,
    stringify(
      {
        book_id: bookId,
        metadata: { authors: ["Fixture Author"], language: "en" },
        publishing: {
          code: { line_numbers: false },
          numbering: { mode: "normalized" },
        },
        revision: configRevision,
        schema_version: 3,
        source: {
          main_markdown: "book.md",
          main_markdown_sha256: markdownSha256,
          original_files: [],
          preprocessing: {
            typography: {
              input_sha256: markdownSha256,
              output_sha256: markdownSha256,
              profile: "verbatim-v1",
              protected_nodes: 2,
              punctuation_converted: 0,
              spaces_normalized: 0,
            },
          },
        },
        source_regions: [],
        structure: headingIds.map((blockId) => ({
          block_id: blockId,
          display_level: 1,
          include_in_toc: true,
          role: "body",
          starts_page: true,
        })),
        title: "Candidate Builder Fixture",
      },
      { lineWidth: 0 },
    ),
    { mode: 0o400 },
  );
}

function article(html: string): string {
  const match = /<article[^>]*>([\s\S]*?)<\/article>/u.exec(html);
  if (!match?.[1]) throw new Error("TEST_READER_ARTICLE_MISSING");
  return match[1];
}

function normalizedArticle(html: string): string {
  return article(html)
    .replaceAll(
      /\/api\/manage\/books\/9\/preview\/3\/pages\/(\d+)/gu,
      "/page/$1",
    )
    .replaceAll(/\/read\/9\/(\d+)/gu, "/page/$1");
}

function distinctPhases(
  messages: readonly BuildCandidateProgressMessage[],
): readonly string[] {
  return messages
    .map((message) => message.phase)
    .filter((phase, index, phases) => phase !== phases[index - 1]);
}

describe("isolated candidate child builder", () => {
  it("builds one immutable preview/public candidate with bounded telemetry", async () => {
    const dataRoot = await createTemporaryDataRoot("candidate-builder");
    try {
      const command = commandFor("success_0001");
      await writeCandidateInput(dataRoot, command);
      const progress: BuildCandidateProgressMessage[] = [];
      const artifact = await handleBuildCandidate({
        command,
        execute: ({ command: parsed, onStage, signal }) =>
          buildCandidateVersion({
            command: parsed,
            createdAtMs,
            layout: dataRoot.layout,
            onStage,
            preparationDiagnostics: [],
            ...(signal ? { signal } : {}),
          }),
        onProgress(message) {
          progress.push(message);
        },
      });

      const candidateDirectory = resolve(
        dataRoot.path,
        artifact.artifactRootRelativePath,
      );
      const [manifest, marker, candidateMetadata] = await Promise.all([
        readFile(
          resolve(candidateDirectory, "document-manifest.json"),
          "utf8",
        ).then((value) => validateDocumentManifest(JSON.parse(value))),
        readFile(resolve(candidateDirectory, "version.json"), "utf8").then(
          (value) => validateVersionMarker(JSON.parse(value)),
        ),
        readFile(
          resolve(candidateDirectory, "derived/candidate.json"),
          "utf8",
        ).then(
          (value) => JSON.parse(value) as Readonly<Record<string, unknown>>,
        ),
      ]);
      expect(artifact).toMatchObject({
        candidateId: command.candidateId,
        compilerIdentity: candidateBuildIdentities.compiler,
        pageCount: 2,
        previewIdentity: candidateBuildIdentities.preview,
        readerIdentity: candidateBuildIdentities.reader,
        rendererIdentity: candidateBuildIdentities.renderer,
        versionId: command.versionId,
      });
      expect(manifest.compiler).toMatchObject({
        renderer_version: command.rendererIdentity,
        version: command.compilerIdentity,
      });
      expect(marker.compiler).toMatchObject({
        renderer_version: command.rendererIdentity,
        version: command.compilerIdentity,
      });
      expect(candidateMetadata).toEqual({
        candidate_id: command.candidateId,
        compiler_identity: command.compilerIdentity,
        preview_identity: command.previewIdentity,
        reader_identity: command.readerIdentity,
        renderer_identity: command.rendererIdentity,
        semantic_digest: artifact.semanticDigest,
        version_id: command.versionId,
      });

      const preview = await readFile(
        resolve(candidateDirectory, "preview/pages/1.html"),
        "utf8",
      );
      const published = await readFile(
        resolve(candidateDirectory, "published/pages/1.html"),
        "utf8",
      );
      expect(normalizedArticle(preview)).toBe(normalizedArticle(published));
      expect(preview).toContain(
        `renderers/${command.rendererIdentity}/katex.css`,
      );
      expect(preview).toContain(`styles/${command.readerIdentity}.css`);
      expect(preview).toContain('data-reader-mode="preview"');
      expect(preview).not.toContain('rel="canonical"');
      expect(preview).not.toContain("reader-book-search");
      expect(published).toContain('data-reader-mode="published"');
      expect(published).toContain('rel="canonical"');

      const manifestLines = (
        await readFile(
          resolve(candidateDirectory, "derived/manifest-pages.ndjson"),
          "utf8",
        )
      )
        .trim()
        .split("\n");
      const searchLines = (
        await readFile(
          resolve(candidateDirectory, "derived/search-rows.ndjson"),
          "utf8",
        )
      )
        .trim()
        .split("\n");
      expect(manifestLines).toHaveLength(artifact.pageCount);
      expect(searchLines).toHaveLength(artifact.searchRowCount);
      await expect(
        access(resolve(candidateDirectory, "derived/search-spool.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        access(resolve(candidateDirectory, ".rendered-pages")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const declaredFiles = (
        marker.files as readonly Readonly<Record<string, unknown>>[]
      ).map((file) => file.path);
      expect(declaredFiles).toEqual(
        expect.arrayContaining([
          "derived/candidate.json",
          "derived/manifest-pages.ndjson",
          "derived/search-rows.ndjson",
          "preview/diagnostics.json",
          "preview/pages/1.html",
          "published/pages/1.html",
          "published/styles/document.css",
        ]),
      );
      expect((await stat(candidateDirectory)).mode & 0o777).toBe(0o500);
      expect(
        (await stat(resolve(candidateDirectory, "preview/pages/1.html"))).mode &
          0o777,
      ).toBe(0o400);
      await expect(
        access(resolve(dataRoot.layout.temporaryDirectory, command.jobId)),
      ).rejects.toMatchObject({ code: "ENOENT" });

      expect(distinctPhases(progress)).toEqual([
        "compile_book",
        "render_pages",
        "build_search",
        "finalize_candidate",
      ]);
      for (const phase of distinctPhases(progress)) {
        const updates = progress.filter((message) => message.phase === phase);
        expect(updates.at(-1)?.progress.completed).toBe(
          updates.at(-1)?.progress.total,
        );
        for (let index = 1; index < updates.length; index += 1) {
          expect(updates[index]?.progress.completed).toBeGreaterThanOrEqual(
            updates[index - 1]?.progress.completed ?? 0,
          );
        }
      }
      expect(progress.every((message) => message.jobId === command.jobId)).toBe(
        true,
      );
      expect(JSON.stringify(artifact)).not.toContain(
        "Candidate Builder Fixture",
      );
      expect(JSON.stringify(artifact)).not.toContain("book.md");
      expect(JSON.stringify(artifact)).not.toContain(dataRoot.path);
    } finally {
      await dataRoot.cleanup();
    }
  });

  it("removes staging and never exposes a ready tree after cancellation", async () => {
    const dataRoot = await createTemporaryDataRoot("candidate-cancel");
    try {
      const command = commandFor("cancel_0001");
      await writeCandidateInput(dataRoot, command);
      const controller = new AbortController();
      await expect(
        handleBuildCandidate({
          command,
          execute: ({ command: parsed, onStage, signal }) =>
            buildCandidateVersion({
              command: parsed,
              createdAtMs,
              layout: dataRoot.layout,
              onStage,
              preparationDiagnostics: [],
              ...(signal ? { signal } : {}),
            }),
          onProgress(message) {
            if (
              message.phase === "render_pages" &&
              message.progress.completed === 0
            ) {
              controller.abort();
            }
          },
          signal: controller.signal,
        }),
      ).rejects.toThrow();
      await expect(
        access(resolve(dataRoot.layout.temporaryDirectory, command.jobId)),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(
        access(
          resolve(
            dataRoot.layout.bookDirectory,
            String(bookId),
            "versions",
            command.versionId,
          ),
        ),
      ).rejects.toMatchObject({ code: "ENOENT" });
      expect(
        await readdir(
          resolve(dataRoot.layout.bookDirectory, String(bookId), "versions"),
        ).catch(() => []),
      ).toEqual([]);
    } finally {
      await dataRoot.cleanup();
    }
  });
});
