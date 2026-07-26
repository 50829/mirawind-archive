import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type Database from "better-sqlite3";

import { renderReaderShell } from "../../components/reader/render.js";
import { prepareConfiguredDocument } from "../../compiler/document/configured-document.js";
import { canonicalJson } from "../../compiler/document/manifest.js";
import type {
  ConfirmedSourceRegion,
  SemanticCompilationIdentity,
  TypographyProvenance,
} from "../../compiler/document/types.js";
import {
  katexCriticalCss,
  rendererStylesheetUrl,
} from "../../compiler/render/assets.js";
import { renderSemanticDocument } from "../../compiler/render/document.js";
import { inspectRasterImage } from "../../compiler/resources/images.js";
import { resolveDocumentResources } from "../../compiler/resources/resolver.js";
import { DraftRepository } from "../../db/repositories/drafts.js";
import type { SafeDiagnostic } from "../../domain/errors.js";
import { parseBookConfigYaml } from "../../schemas/book-config.js";
import { atomicWriteFile, resolveContainedPath } from "../../storage/layout.js";
import type { StorageLayout } from "../../storage/layout.js";
import { readerStylesheetUrl } from "../../styles/assets.js";

export const previewBuildVersion = "draft-preview-v3";
export const previewBuildArtifactFilename = "preview-build-result.json";

export interface PreviewBuildArtifact {
  readonly diagnosticsRelativePath: string;
  readonly identity: SemanticCompilationIdentity;
  readonly previewRelativePath: "preview";
  readonly version: typeof previewBuildVersion;
}

function dataRelativePath(root: string, target: string): string {
  const result = relative(root, target).split(sep).join("/");
  if (!result || result === ".." || result.startsWith("../")) {
    throw new Error("PREVIEW_STORAGE_PATH_INVALID");
  }
  return result;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readerHtmlDocument(input: {
  readonly body: string;
  readonly css: string;
  readonly language: string;
  readonly title: string;
}): string {
  return `<!doctype html>
<html lang="${htmlEscape(input.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${htmlEscape(input.title)}</title>
<link rel="stylesheet" href="${rendererStylesheetUrl}">
<link rel="stylesheet" href="${readerStylesheetUrl}">
<style>${katexCriticalCss}${input.css}</style>
</head>
<body>${input.body}</body>
</html>
`;
}

export async function buildPreview(input: {
  readonly bookId: number;
  readonly configRevision: number;
  readonly configYamlPath: string;
  readonly sourceRoot: string;
  readonly stagingDirectory: string;
}): Promise<PreviewBuildArtifact> {
  const stagingDirectory = resolve(input.stagingDirectory);
  const previewDirectory = resolve(stagingDirectory, "preview");
  try {
    await mkdir(resolve(stagingDirectory, ".."), {
      mode: 0o700,
      recursive: true,
    });
    await mkdir(stagingDirectory, { mode: 0o700, recursive: false });
    await mkdir(previewDirectory, { mode: 0o700, recursive: false });
    const configYaml = await readFile(input.configYamlPath, "utf8");
    const config = parseBookConfigYaml(configYaml);
    if (
      config.book_id !== input.bookId ||
      config.revision !== input.configRevision
    ) {
      throw new Error("PREVIEW_CONFIG_CAPTURE_MISMATCH");
    }
    const source = config.source as Readonly<Record<string, unknown>>;
    const mainMarkdown = String(source.main_markdown);
    const markdownPath = await resolveContainedPath(
      input.sourceRoot,
      mainMarkdown,
    );
    const markdownBytes = await readFile(markdownPath);
    if (
      createHash("sha256").update(markdownBytes).digest("hex") !==
      source.main_markdown_sha256
    ) {
      throw new Error("PREVIEW_SOURCE_HASH_MISMATCH");
    }
    const configured = prepareConfiguredDocument({
      config,
      configSha256: createHash("sha256").update(configYaml).digest("hex"),
      markdownBytes,
    });
    const resolution = await resolveDocumentResources({
      document: configured.document,
      markdownPath,
      resourceRoot: input.sourceRoot,
    });
    const assetsDirectory = resolve(previewDirectory, "assets");
    await mkdir(assetsDirectory, { mode: 0o700 });
    for (const resource of resolution.resources) {
      const bytes = await readFile(resource.absolutePath);
      await inspectRasterImage({
        bytes,
        filename: resource.relativePath,
      });
      await atomicWriteFile(resolve(assetsDirectory, resource.id), bytes, {
        mode: 0o600,
      });
    }
    const pagesDirectory = resolve(previewDirectory, "pages");
    await mkdir(pagesDirectory, { mode: 0o700 });
    const pageByHeading = new Map(
      configured.pages.flatMap((page) =>
        page.document.headings
          .filter((heading) => page.blockIds.includes(heading.blockId))
          .map((heading) => [heading.blockId, page.pageId] as const),
      ),
    );
    const pageById = new Map(
      configured.pages.map((page) => [page.pageId, page] as const),
    );
    const pageHref = (pageId: number) =>
      `/api/manage/books/${input.bookId}/preview/${input.configRevision}/pages/${pageId}`;
    const displayHeadingTitle = (
      heading: (typeof configured.headings)[number],
    ) =>
      heading.number
        ? `${heading.number}. ${heading.display_title}`
        : heading.display_title;
    const readerToc = configured.headings
      .filter((heading) => heading.include_in_toc)
      .map((heading) => {
        const pageId = pageByHeading.get(heading.block_id);
        if (!pageId || !pageById.has(pageId)) {
          throw new Error("PREVIEW_HEADING_PAGE_MISSING");
        }
        return {
          blockId: heading.block_id,
          href: `${pageHref(pageId)}#${heading.block_id}`,
          level: heading.display_level,
          pageId,
          title: displayHeadingTitle(heading),
        };
      });
    const diagnostics: SafeDiagnostic[] = [...resolution.diagnostics];
    const renderedPages = await Promise.all(
      configured.pages.map(async (page) => {
        const rendered = await renderSemanticDocument({
          document: page.document,
          headingHref(blockId) {
            const pageId = pageByHeading.get(blockId);
            if (!pageId) throw new Error("PREVIEW_HEADING_PAGE_MISSING");
            return `${pageHref(pageId)}#${blockId}`;
          },
          headingOverrides: page.headingOverrides,
          publishedResourceUrl: (resourceId) =>
            `/api/manage/books/${input.bookId}/preview/${input.configRevision}/assets/${resourceId}`,
          resourceResolution: resolution,
        });
        diagnostics.push(...rendered.diagnostics);
        return { page, rendered };
      }),
    );
    const css = renderedPages
      .map(({ rendered }) => rendered.css)
      .filter(Boolean)
      .sort()
      .filter((value, index, values) => value !== values[index - 1])
      .join("");
    const language =
      typeof (config.metadata as Record<string, unknown> | undefined)
        ?.language === "string"
        ? String(
            (config.metadata as Record<string, unknown> | undefined)?.language,
          )
        : "zh-CN";
    for (const { page, rendered } of renderedPages) {
      const pageIndex = configured.pages.findIndex(
        (candidate) => candidate.pageId === page.pageId,
      );
      const nextPage =
        pageIndex >= 0 ? configured.pages.at(pageIndex + 1) : undefined;
      const previousPage =
        pageIndex > 0 ? configured.pages.at(pageIndex - 1) : undefined;
      const outline = configured.headings
        .filter(
          (heading) =>
            heading.include_in_toc && page.blockIds.includes(heading.block_id),
        )
        .map((heading) => ({
          blockId: heading.block_id,
          href: `#${heading.block_id}`,
          level: heading.display_level,
          title: displayHeadingTitle(heading),
        }));
      await atomicWriteFile(
        resolve(pagesDirectory, `${page.pageId}.html`),
        readerHtmlDocument({
          body: renderReaderShell({
            bodyHtml: rendered.html,
            bookKey: String(input.bookId),
            bookTitle: String(config.title),
            currentHeadingId: outline.at(0)?.blockId ?? null,
            currentPageId: page.pageId,
            firstPageHref: pageHref(
              configured.pages.at(0)?.pageId ?? page.pageId,
            ),
            mode: "preview",
            nextHref: nextPage ? pageHref(nextPage.pageId) : null,
            originalDownloads: [],
            outline,
            previousHref: previousPage ? pageHref(previousPage.pageId) : null,
            previewRevision: input.configRevision,
            toc: readerToc,
          }),
          css,
          language,
          title: page.title,
        }),
        { mode: 0o600 },
      );
    }
    const boundedDiagnostics = [
      ...new Map(
        diagnostics
          .slice(0, 10_000)
          .map(
            (diagnostic) => [JSON.stringify(diagnostic), diagnostic] as const,
          ),
      ).values(),
    ];
    const sourceRegions = (
      config.source_regions as readonly ConfirmedSourceRegion[]
    ).map((region) => ({
      applied: region.applied,
      confidence: "high",
      conflict_count: 0,
      end_byte: region.range.end_byte,
      entry_count: region.entries.length,
      kind: region.kind,
      matched_heading_count: region.entries.filter(
        (entry) => entry.body_heading_block_id,
      ).length,
      region_id: region.region_id,
      start_byte: region.range.start_byte,
    }));
    const typography = (
      (config.source as Readonly<Record<string, unknown>>)
        .preprocessing as Readonly<Record<string, unknown>>
    ).typography as TypographyProvenance;
    const model = Object.freeze({
      compiler_version: configured.identity.compiler_version,
      config_sha256: configured.identity.config_sha256,
      config_revision: input.configRevision,
      headings: configured.headings.map((heading) => ({
        block_id: heading.block_id,
        display_level: heading.display_level,
        include_in_toc: heading.include_in_toc,
        number: heading.number,
        page_id: pageByHeading.get(heading.block_id) ?? null,
        role: heading.role,
        source_level: heading.source_level,
        source_title: heading.source_title,
        starts_page: heading.starts_page,
        title: heading.display_title,
      })),
      pages: configured.pages.map((page) => ({
        page_id: page.pageId,
        title: page.title,
      })),
      renderer_version: configured.identity.renderer_version,
      semantic_digest: configured.identity.semantic_digest,
      source_regions: sourceRegions,
      source_sha256: configured.identity.source_sha256,
      typography,
      version: previewBuildVersion,
    });
    const diagnosticsPath = resolve(previewDirectory, "diagnostics.json");
    await atomicWriteFile(
      diagnosticsPath,
      canonicalJson({ diagnostics: boundedDiagnostics }),
      { mode: 0o600 },
    );
    await atomicWriteFile(
      resolve(previewDirectory, "preview-model.json"),
      canonicalJson(model),
      { mode: 0o600 },
    );
    const artifact: PreviewBuildArtifact = Object.freeze({
      diagnosticsRelativePath: "diagnostics.json",
      identity: configured.identity,
      previewRelativePath: "preview",
      version: previewBuildVersion,
    });
    await atomicWriteFile(
      resolve(stagingDirectory, previewBuildArtifactFilename),
      canonicalJson(artifact),
      { mode: 0o600 },
    );
    return artifact;
  } catch (error) {
    await rm(stagingDirectory, { force: true, recursive: true });
    throw error;
  }
}

export async function finalizeBuiltPreview(input: {
  readonly artifact: PreviewBuildArtifact;
  readonly bookId: number;
  readonly configRevision: number;
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
  readonly stagingDirectory: string;
}): Promise<void> {
  if (input.artifact.version !== previewBuildVersion) {
    throw new Error("PREVIEW_BUILD_ARTIFACT_INVALID");
  }
  const finalDirectory = resolve(
    input.layout.bookDirectory,
    String(input.bookId),
    "draft",
    "previews",
    String(input.configRevision),
  );
  const stagedPreviewDirectory = await resolveContainedPath(
    input.stagingDirectory,
    input.artifact.previewRelativePath,
  );
  await mkdir(resolve(finalDirectory, ".."), { mode: 0o700, recursive: true });
  try {
    await rename(stagedPreviewDirectory, finalDirectory);
    const diagnosticsPath = resolve(
      finalDirectory,
      input.artifact.diagnosticsRelativePath,
    );
    new DraftRepository(input.database).completePreview({
      bookId: input.bookId,
      configRevision: input.configRevision,
      diagnosticsRelativePath: dataRelativePath(
        input.layout.root,
        diagnosticsPath,
      ),
      nowMs: input.nowMs,
      previewRelativePath: dataRelativePath(input.layout.root, finalDirectory),
    });
  } catch (error) {
    await rm(finalDirectory, { force: true, recursive: true });
    throw error;
  }
}

export function previewArtifactPath(stagingDirectory: string): string {
  return resolve(stagingDirectory, previewBuildArtifactFilename);
}

export async function readPreviewBuildArtifact(
  stagingDirectory: string,
): Promise<PreviewBuildArtifact> {
  const parsed: unknown = JSON.parse(
    await readFile(previewArtifactPath(stagingDirectory), "utf8"),
  );
  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as Record<string, unknown>).version !== previewBuildVersion ||
    (parsed as Record<string, unknown>).previewRelativePath !== "preview" ||
    (parsed as Record<string, unknown>).diagnosticsRelativePath !==
      "diagnostics.json"
  ) {
    throw new Error("PREVIEW_BUILD_ARTIFACT_INVALID");
  }
  return parsed as PreviewBuildArtifact;
}
