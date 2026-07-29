import { resolve } from "node:path";

import { renderReaderShell } from "@/components/reader/render";
import type { prepareConfiguredDocument } from "@/compiler/document/configured-document";
import { renderSemanticDocument } from "@/compiler/render/document";
import { renderReaderHtmlDocument } from "@/compiler/render/reader-document";
import type { resolveDocumentResources } from "@/compiler/resources/resolver";
import type { SafeDiagnostic } from "@/domain/errors";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";
import { atomicWriteFile } from "@/storage/layout";

type ConfiguredDocument = Awaited<ReturnType<typeof prepareConfiguredDocument>>;
type ResourceResolution = Awaited<ReturnType<typeof resolveDocumentResources>>;

const nonBlockingRenderDiagnosticCodes = new Set([
  "CODE_LANGUAGE_UNSUPPORTED",
  "MATH_RENDER_FAILED",
]);

function assertNonBlockingRenderDiagnostics(
  diagnostics: readonly SafeDiagnostic[],
): void {
  if (
    diagnostics.some(
      (diagnostic) => !nonBlockingRenderDiagnosticCodes.has(diagnostic.code),
    )
  ) {
    throw new Error("VERSION_RENDER_DIAGNOSTIC");
  }
}

export async function materializeVersionPages(input: {
  readonly bookId: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly configured: ConfiguredDocument;
  readonly originalFiles: readonly Readonly<Record<string, unknown>>[];
  readonly resourceResolution: ResourceResolution;
  readonly versionDirectory: string;
  readonly versionId: string;
}): Promise<void> {
  const { headings, pages } = input.configured;
  const bookKey =
    typeof input.config.alias === "string"
      ? input.config.alias
      : String(input.bookId);
  const pageHref = (candidate: (typeof pages)[number]) =>
    `/read/${bookKey}/${candidate.alias ?? candidate.pageId}`;
  const displayHeadingTitle = (heading: (typeof headings)[number]) =>
    heading.number
      ? `${heading.number}. ${heading.display_title}`
      : heading.display_title;
  const { pageByHeading, pageById, readerToc } = await profilePipelineStage(
    "page_model",
    () => {
      const headingsToPages = new Map(
        pages.flatMap((page) =>
          page.document.headings
            .filter((heading) => page.blockIds.includes(heading.blockId))
            .map((heading) => [heading.blockId, page.pageId] as const),
        ),
      );
      const pagesById = new Map(pages.map((page) => [page.pageId, page]));
      const toc = headings
        .filter((heading) => heading.include_in_toc)
        .map((heading) => {
          const pageId = headingsToPages.get(heading.block_id);
          const headingPage = pageId ? pagesById.get(pageId) : undefined;
          if (!pageId || !headingPage) {
            throw new Error("VERSION_HEADING_PAGE_MISSING");
          }
          return Object.freeze({
            blockId: heading.block_id,
            href: `${pageHref(headingPage)}#${heading.block_id}`,
            level: heading.display_level,
            pageId,
            title: displayHeadingTitle(heading),
          });
        });
      return {
        pageByHeading: headingsToPages,
        pageById: pagesById,
        readerToc: toc,
      };
    },
  );
  const renderedPages = await profilePipelineStage("page_render", () =>
    Promise.all(
      pages.map(async (page) => {
        const rendered = await renderSemanticDocument({
          document: page.document,
          headingHref(blockId) {
            const pageId = pageByHeading.get(blockId);
            if (!pageId) throw new Error("VERSION_HEADING_PAGE_MISSING");
            const headingPage = pageById.get(pageId);
            if (!headingPage) throw new Error("VERSION_HEADING_PAGE_MISSING");
            return `${pageHref(headingPage)}#${blockId}`;
          },
          headingOverrides: page.headingOverrides,
          publishedResourceUrl: (resourceId) =>
            `/books/${input.bookId}/assets/${input.versionId}/${resourceId}`,
          resourceResolution: input.resourceResolution,
        });
        assertNonBlockingRenderDiagnostics(rendered.diagnostics);
        return { page, rendered };
      }),
    ),
  );
  const css = renderedPages
    .map(({ rendered }) => rendered.css)
    .filter(Boolean)
    .sort()
    .filter((value, index, values) => value !== values[index - 1])
    .join("");
  const cssPath = "published/styles/document.css";
  const metadata = input.config.metadata as
    Readonly<Record<string, unknown>> | undefined;
  const language =
    typeof metadata?.language === "string" ? metadata.language : "zh-CN";
  let outputBytes = Buffer.byteLength(css);
  await profilePipelineStage("page_write", async () => {
    await atomicWriteFile(resolve(input.versionDirectory, cssPath), css, {
      mode: 0o400,
    });
    for (const { page, rendered } of renderedPages) {
      const pageIndex = pages.findIndex(
        (candidate) => candidate.pageId === page.pageId,
      );
      const nextPage = pageIndex >= 0 ? pages.at(pageIndex + 1) : undefined;
      const previousPage = pageIndex > 0 ? pages.at(pageIndex - 1) : undefined;
      const outline = headings
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
      const html = renderReaderHtmlDocument({
        body: renderReaderShell({
          bodyHtml: rendered.html,
          bookKey,
          bookTitle: String(input.config.title),
          currentHeadingId: outline.at(0)?.blockId ?? null,
          currentPageId: page.pageId,
          firstPageHref: pageHref(pages[0] ?? page),
          nextHref: nextPage ? pageHref(nextPage) : null,
          originalDownloads: input.originalFiles.map((original) => ({
            href: `/books/${bookKey}/originals/${String(original.id)}`,
            label:
              String(original.role) === "mineru_zip"
                ? "下载原始 ZIP"
                : "下载原文件",
          })),
          outline,
          previousHref: previousPage ? pageHref(previousPage) : null,
          toc: readerToc,
        }),
        canonicalPath: pageHref(page),
        css,
        language,
        title: page.title,
      });
      outputBytes += Buffer.byteLength(html);
      await atomicWriteFile(
        resolve(input.versionDirectory, page.outputPath),
        html,
        { mode: 0o400 },
      );
    }
  });
  recordPipelineProfileMetrics({ output_bytes: outputBytes });
}
