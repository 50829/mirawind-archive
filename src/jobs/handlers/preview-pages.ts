import { mkdir } from "node:fs/promises";
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

export async function renderPreviewPages(input: {
  readonly bookId: number;
  readonly config: Readonly<Record<string, unknown>>;
  readonly configRevision: number;
  readonly configured: ConfiguredDocument;
  readonly preparationDiagnostics: readonly SafeDiagnostic[];
  readonly previewDirectory: string;
  readonly resolution: ResourceResolution;
}): Promise<{
  readonly diagnostics: readonly SafeDiagnostic[];
  readonly pageByHeading: ReadonlyMap<string, number>;
}> {
  const pagesDirectory = resolve(input.previewDirectory, "pages");
  await mkdir(pagesDirectory, { mode: 0o700 });
  const pageHref = (pageId: number) =>
    `/api/manage/books/${input.bookId}/preview/${input.configRevision}/pages/${pageId}`;
  const displayHeadingTitle = (
    heading: (typeof input.configured.headings)[number],
  ) =>
    heading.number
      ? `${heading.number}. ${heading.display_title}`
      : heading.display_title;
  const { pageByHeading, readerToc } = await profilePipelineStage(
    "page_model",
    () => {
      const headingsToPages = new Map(
        input.configured.pages.flatMap((page) =>
          page.document.headings
            .filter((heading) => page.blockIds.includes(heading.blockId))
            .map((heading) => [heading.blockId, page.pageId] as const),
        ),
      );
      const pagesById = new Map(
        input.configured.pages.map((page) => [page.pageId, page] as const),
      );
      const toc = input.configured.headings
        .filter((heading) => heading.include_in_toc)
        .map((heading) => {
          const pageId = headingsToPages.get(heading.block_id);
          if (!pageId || !pagesById.has(pageId)) {
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
      return { pageByHeading: headingsToPages, readerToc: toc };
    },
  );
  const diagnostics: SafeDiagnostic[] = [
    ...input.preparationDiagnostics,
    ...input.resolution.diagnostics,
  ];
  const renderedPages = await profilePipelineStage("page_render", () =>
    Promise.all(
      input.configured.pages.map(async (page) => {
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
          resourceResolution: input.resolution,
        });
        diagnostics.push(...rendered.diagnostics);
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
  const metadata = input.config.metadata as
    Readonly<Record<string, unknown>> | undefined;
  const language =
    typeof metadata?.language === "string" ? metadata.language : "zh-CN";
  let outputBytes = 0;
  await profilePipelineStage("page_write", async () => {
    for (const { page, rendered } of renderedPages) {
      const pageIndex = input.configured.pages.findIndex(
        (candidate) => candidate.pageId === page.pageId,
      );
      const nextPage =
        pageIndex >= 0 ? input.configured.pages.at(pageIndex + 1) : undefined;
      const previousPage =
        pageIndex > 0 ? input.configured.pages.at(pageIndex - 1) : undefined;
      const outline = input.configured.headings
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
          bookKey: String(input.bookId),
          bookTitle: String(input.config.title),
          currentHeadingId: outline.at(0)?.blockId ?? null,
          currentPageId: page.pageId,
          firstPageHref: pageHref(
            input.configured.pages.at(0)?.pageId ?? page.pageId,
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
      });
      outputBytes += Buffer.byteLength(html);
      await atomicWriteFile(
        resolve(pagesDirectory, `${page.pageId}.html`),
        html,
        {
          mode: 0o600,
        },
      );
    }
  });
  recordPipelineProfileMetrics({ output_bytes: outputBytes });
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    pageByHeading,
  });
}
