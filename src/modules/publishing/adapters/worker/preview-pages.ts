import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { SafeDiagnostic } from "@/domain/errors";
import type { CompiledBook } from "@/modules/publishing/core/publication/compiled-book";
import { pageMetadata } from "@/modules/publishing/core/publication/compiled-book";
import { renderPages } from "@/modules/publishing/core/publication/render-pages";
import type { ResourceResolution } from "@/modules/publishing/core/publication/resource-model";
import { materializeRouteNeutralHtml } from "@/modules/publishing/adapters/reader-html/materialize-route-neutral-html";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";
import { atomicWriteFile } from "@/platform/filesystem/layout";
import { renderReaderHtmlDocument } from "@/web/features/reader/render-document";
import { renderReaderShell } from "@/web/features/reader/render";

export async function renderPreviewPages(input: {
  readonly bookId: number;
  readonly compiled: CompiledBook;
  readonly config: Readonly<Record<string, unknown>>;
  readonly configRevision: number;
  readonly preparationDiagnostics: readonly SafeDiagnostic[];
  readonly previewDirectory: string;
  readonly resolution: ResourceResolution;
}): Promise<{
  readonly diagnostics: readonly SafeDiagnostic[];
  readonly pageByHeading: ReadonlyMap<string, number>;
}> {
  const { compiled } = input;
  const pagesDirectory = resolve(input.previewDirectory, "pages");
  const bodyDirectory = resolve(input.previewDirectory, ".rendered-pages");
  await mkdir(pagesDirectory, { mode: 0o700 });
  await mkdir(bodyDirectory, { mode: 0o700 });
  const pageHref = (pageId: number) =>
    `/api/manage/books/${input.bookId}/preview/${input.configRevision}/pages/${pageId}`;
  const displayHeadingTitle = (heading: CompiledBook["headings"][number]) =>
    heading.number
      ? `${heading.number}. ${heading.display_title}`
      : heading.display_title;
  const { headingsByPageId, pageByHeading, readerToc } =
    await profilePipelineStage("page_model", () => {
      const headingsToPages = new Map<string, number>();
      const byPageId = new Map<number, CompiledBook["headings"][number][]>();
      for (const heading of compiled.headings) {
        const page = compiled.pageByHeadingId.get(heading.block_id);
        if (!page) throw new Error("PREVIEW_HEADING_PAGE_MISSING");
        headingsToPages.set(heading.block_id, page.pageId);
        const values = byPageId.get(page.pageId) ?? [];
        values.push(heading);
        byPageId.set(page.pageId, values);
      }
      const toc = compiled.headings
        .filter((heading) => heading.include_in_toc)
        .map((heading) => {
          const pageId = headingsToPages.get(heading.block_id);
          if (!pageId) throw new Error("PREVIEW_HEADING_PAGE_MISSING");
          return Object.freeze({
            blockId: heading.block_id,
            href: `${pageHref(pageId)}#${heading.block_id}`,
            level: heading.display_level,
            pageId,
            title: displayHeadingTitle(heading),
          });
        });
      return Object.freeze({
        headingsByPageId: byPageId,
        pageByHeading: headingsToPages,
        readerToc: toc,
      });
    });
  const diagnostics: SafeDiagnostic[] = [
    ...input.preparationDiagnostics,
    ...input.resolution.diagnostics,
  ];

  try {
    const styles = new Set<string>();
    await profilePipelineStage("page_render", async () => {
      for await (const rendered of renderPages({
        book: compiled,
        resourceResolution: input.resolution,
      })) {
        diagnostics.push(...rendered.diagnostics);
        if (rendered.css) styles.add(rendered.css);
        await atomicWriteFile(
          resolve(bodyDirectory, `${rendered.page.pageId}.html`),
          materializeRouteNeutralHtml({
            headingHref(blockId) {
              const pageId = pageByHeading.get(blockId);
              if (!pageId) throw new Error("PREVIEW_HEADING_PAGE_MISSING");
              return `${pageHref(pageId)}#${blockId}`;
            },
            html: rendered.html,
            resourceUrl: (resourceId) =>
              `/api/manage/books/${input.bookId}/preview/${input.configRevision}/assets/${resourceId}`,
          }),
          { mode: 0o600 },
        );
      }
    });
    const css = [...styles].sort().join("");
    const metadata = input.config.metadata as
      Readonly<Record<string, unknown>> | undefined;
    const language =
      typeof metadata?.language === "string" ? metadata.language : "zh-CN";
    let outputBytes = 0;
    await profilePipelineStage("page_write", async () => {
      for (const [ordinal, page] of compiled.pages.entries()) {
        const nextPage = compiled.pages[ordinal + 1];
        const previousPage = compiled.pages[ordinal - 1];
        const outline = (headingsByPageId.get(page.pageId) ?? [])
          .filter((heading) => heading.include_in_toc)
          .map((heading) => ({
            blockId: heading.block_id,
            href: `#${heading.block_id}`,
            level: heading.display_level,
            title: displayHeadingTitle(heading),
          }));
        const bodyHtml = await readFile(
          resolve(bodyDirectory, `${page.pageId}.html`),
          "utf8",
        );
        const html = renderReaderHtmlDocument({
          body: renderReaderShell({
            bodyHtml,
            bookKey: String(input.bookId),
            bookTitle: compiled.bookTitle,
            currentHeadingId: outline.at(0)?.blockId ?? null,
            currentPageId: page.pageId,
            firstPageHref: pageHref(compiled.pages[0]?.pageId ?? page.pageId),
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
          title: pageMetadata(compiled, page).title,
        });
        outputBytes += Buffer.byteLength(html);
        await atomicWriteFile(
          resolve(pagesDirectory, `${page.pageId}.html`),
          html,
          { mode: 0o600 },
        );
      }
    });
    recordPipelineProfileMetrics({ output_bytes: outputBytes });
    return Object.freeze({
      diagnostics: Object.freeze(diagnostics),
      pageByHeading,
    });
  } finally {
    await rm(bodyDirectory, { force: true, recursive: true });
  }
}
