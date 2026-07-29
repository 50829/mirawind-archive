import { mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import type { SafeDiagnostic } from "@/domain/errors";
import type { CompiledBook } from "@/modules/publishing/core/publication/compiled-book";
import { pageMetadata } from "@/modules/publishing/core/publication/compiled-book";
import { renderPages } from "@/modules/publishing/core/publication/render-pages";
import type { ResourceResolution } from "@/modules/publishing/core/publication/resource-model";
import {
  profilePipelineStage,
  recordPipelineProfileMetrics,
} from "@/observability/pipeline-profile";
import { atomicWriteFile } from "@/platform/filesystem/layout";
import { renderReaderHtmlDocument } from "@/web/features/reader/render-document";
import { renderReaderShell } from "@/web/features/reader/render";

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
  readonly compiled: CompiledBook;
  readonly config: Readonly<Record<string, unknown>>;
  readonly originalFiles: readonly Readonly<Record<string, unknown>>[];
  readonly resourceResolution: ResourceResolution;
  readonly versionDirectory: string;
  readonly versionId: string;
}): Promise<void> {
  const { compiled } = input;
  const bookKey =
    typeof input.config.alias === "string"
      ? input.config.alias
      : String(input.bookId);
  const pageHref = (page: CompiledBook["pages"][number]) => {
    const metadata = pageMetadata(compiled, page);
    return `/read/${bookKey}/${metadata.alias ?? page.pageId}`;
  };
  const displayHeadingTitle = (heading: CompiledBook["headings"][number]) =>
    heading.number
      ? `${heading.number}. ${heading.display_title}`
      : heading.display_title;
  const { headingsByPageId, readerToc } = await profilePipelineStage(
    "page_model",
    () => {
      const byPageId = new Map<number, CompiledBook["headings"][number][]>();
      for (const heading of compiled.headings) {
        const page = compiled.pageByHeadingId.get(heading.block_id);
        if (!page) throw new Error("VERSION_HEADING_PAGE_MISSING");
        const values = byPageId.get(page.pageId) ?? [];
        values.push(heading);
        byPageId.set(page.pageId, values);
      }
      const toc = compiled.headings
        .filter((heading) => heading.include_in_toc)
        .map((heading) => {
          const page = compiled.pageByHeadingId.get(heading.block_id);
          if (!page) throw new Error("VERSION_HEADING_PAGE_MISSING");
          return Object.freeze({
            blockId: heading.block_id,
            href: `${pageHref(page)}#${heading.block_id}`,
            level: heading.display_level,
            pageId: page.pageId,
            title: displayHeadingTitle(heading),
          });
        });
      return Object.freeze({ headingsByPageId: byPageId, readerToc: toc });
    },
  );

  const bodyDirectory = resolve(input.versionDirectory, ".rendered-pages");
  await mkdir(bodyDirectory, { mode: 0o700 });
  try {
    const styles = new Set<string>();
    await profilePipelineStage("page_render", async () => {
      for await (const rendered of renderPages({
        book: compiled,
        headingHref(blockId) {
          const page = compiled.pageByHeadingId.get(blockId);
          if (!page) throw new Error("VERSION_HEADING_PAGE_MISSING");
          return `${pageHref(page)}#${blockId}`;
        },
        publishedResourceUrl: (resourceId) =>
          `/books/${input.bookId}/assets/${input.versionId}/${resourceId}`,
        resourceResolution: input.resourceResolution,
      })) {
        assertNonBlockingRenderDiagnostics(rendered.diagnostics);
        if (rendered.css) styles.add(rendered.css);
        await atomicWriteFile(
          resolve(bodyDirectory, `${rendered.page.pageId}.html`),
          rendered.html,
          { mode: 0o600 },
        );
      }
    });
    const css = [...styles].sort().join("");
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
            bookKey,
            bookTitle: compiled.bookTitle,
            currentHeadingId: outline.at(0)?.blockId ?? null,
            currentPageId: page.pageId,
            firstPageHref: pageHref(compiled.pages[0] ?? page),
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
          title: pageMetadata(compiled, page).title,
        });
        outputBytes += Buffer.byteLength(html);
        await atomicWriteFile(
          resolve(
            input.versionDirectory,
            `published/pages/${page.pageId}.html`,
          ),
          html,
          { mode: 0o400 },
        );
      }
    });
    recordPipelineProfileMetrics({ output_bytes: outputBytes });
  } finally {
    await rm(bodyDirectory, { force: true, recursive: true });
  }
}
