import {
  chmod,
  mkdir,
  open,
  readFile,
  rm,
  type FileHandle,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { SafeDiagnostic } from "@/domain/errors";
import {
  buildSearchRowsForBlocks,
  buildSearchShortRows,
  type SearchRowCursor,
} from "@/modules/publishing/core/publication/search-model";
import { materializeRouteNeutralHtml } from "@/modules/publishing/adapters/reader-html/materialize-route-neutral-html";
import type { CompiledBook } from "@/modules/publishing/core/publication/compiled-book";
import { pageMetadata } from "@/modules/publishing/core/publication/compiled-book";
import { buildManifestPageRecord } from "@/modules/publishing/core/publication/manifest";
import {
  renderPages,
  type PageRenderer,
} from "@/modules/publishing/core/publication/render-pages";
import type { ResourceResolution } from "@/modules/publishing/core/publication/resource-model";
import { atomicWriteFile } from "@/platform/filesystem/layout";
import { renderReaderHtmlDocument } from "@/web/features/reader/render-document";
import { renderReaderShell } from "@/web/features/reader/render";

const nonBlockingRenderDiagnosticCodes = new Set([
  "CODE_LANGUAGE_UNSUPPORTED",
  "MATH_RENDER_FAILED",
]);

interface NavigationLink {
  readonly blockId: string;
  readonly level: number;
  readonly pageId: number;
  readonly title: string;
}

class JsonLineSpool {
  readonly #path: string;
  #buffer: string[] = [];
  #bufferBytes = 0;
  #handle: FileHandle | undefined;

  constructor(path: string) {
    this.#path = path;
  }

  async open(): Promise<void> {
    await mkdir(dirname(this.#path), { mode: 0o700, recursive: true });
    this.#handle = await open(this.#path, "wx", 0o600);
  }

  async #flush(): Promise<void> {
    if (!this.#handle) throw new Error("CANDIDATE_SPOOL_NOT_OPEN");
    if (this.#buffer.length === 0) return;
    const chunk = this.#buffer.join("");
    this.#buffer = [];
    this.#bufferBytes = 0;
    await this.#handle.writeFile(chunk, "utf8");
  }

  async writeMany(values: readonly unknown[]): Promise<void> {
    if (!this.#handle) throw new Error("CANDIDATE_SPOOL_NOT_OPEN");
    for (const value of values) {
      const line = `${JSON.stringify(value)}\n`;
      this.#buffer.push(line);
      this.#bufferBytes += Buffer.byteLength(line);
    }
    if (this.#bufferBytes >= 256 * 1024) await this.#flush();
  }

  async close(): Promise<void> {
    const handle = this.#handle;
    if (!handle) return;
    await this.#flush();
    this.#handle = undefined;
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(this.#path, 0o400);
  }

  async abort(): Promise<void> {
    const handle = this.#handle;
    this.#handle = undefined;
    this.#buffer = [];
    this.#bufferBytes = 0;
    await handle?.close().catch(() => undefined);
    await rm(this.#path, { force: true });
  }
}

function displayHeadingTitle(
  heading: CompiledBook["headings"][number],
): string {
  return heading.number
    ? `${heading.number}. ${heading.display_title}`
    : heading.display_title;
}

function assertNonBlockingDiagnostics(
  diagnostics: readonly SafeDiagnostic[],
): void {
  if (
    diagnostics.some(
      (diagnostic) => !nonBlockingRenderDiagnosticCodes.has(diagnostic.code),
    )
  ) {
    throw new Error("CANDIDATE_RENDER_DIAGNOSTIC");
  }
}

export interface CandidateMaterializationResult {
  readonly diagnostics: readonly SafeDiagnostic[];
  readonly manifestPageCount: number;
  readonly outputBytes: number;
  readonly pageByHeading: ReadonlyMap<string, number>;
  readonly pageCount: number;
  readonly searchFtsRowCount: number;
  readonly searchShortRowCount: number;
}

export async function materializeCandidatePages(input: {
  readonly bookId: number;
  readonly candidateDirectory: string;
  readonly compiled: CompiledBook;
  readonly config: Readonly<Record<string, unknown>>;
  readonly configRevision: number;
  readonly originalFiles: readonly Readonly<Record<string, unknown>>[];
  readonly onPageRendered?: (completed: number, total: number) => void;
  readonly preparationDiagnostics?: readonly SafeDiagnostic[];
  readonly renderPage?: PageRenderer;
  readonly resourceResolution: ResourceResolution;
  readonly signal?: AbortSignal;
  readonly versionId: string;
}): Promise<CandidateMaterializationResult> {
  const { compiled } = input;
  const previewDirectory = resolve(input.candidateDirectory, "preview");
  const publishedDirectory = resolve(input.candidateDirectory, "published");
  const bodyDirectory = resolve(input.candidateDirectory, ".rendered-pages");
  await Promise.all([
    mkdir(resolve(previewDirectory, "pages"), {
      mode: 0o700,
      recursive: true,
    }),
    mkdir(resolve(publishedDirectory, "pages"), {
      mode: 0o700,
      recursive: true,
    }),
    mkdir(resolve(publishedDirectory, "styles"), {
      mode: 0o700,
      recursive: true,
    }),
    mkdir(bodyDirectory, { mode: 0o700, recursive: true }),
  ]);

  const manifestSpool = new JsonLineSpool(
    resolve(input.candidateDirectory, "derived/manifest-pages.ndjson"),
  );
  const searchSpool = new JsonLineSpool(
    resolve(input.candidateDirectory, "derived/search-rows.ndjson"),
  );
  const pageByHeading = new Map<string, number>();
  const headingsByPageId = new Map<
    number,
    CompiledBook["headings"][number][]
  >();
  const navigation: NavigationLink[] = [];
  for (const heading of compiled.headings) {
    const page = compiled.pageByHeadingId.get(heading.block_id);
    if (!page) throw new Error("CANDIDATE_HEADING_PAGE_MISSING");
    pageByHeading.set(heading.block_id, page.pageId);
    const pageHeadings = headingsByPageId.get(page.pageId) ?? [];
    pageHeadings.push(heading);
    headingsByPageId.set(page.pageId, pageHeadings);
    if (heading.include_in_toc) {
      navigation.push(
        Object.freeze({
          blockId: heading.block_id,
          level: heading.display_level,
          pageId: page.pageId,
          title: displayHeadingTitle(heading),
        }),
      );
    }
  }

  const metadata = input.config.metadata as
    Readonly<Record<string, unknown>> | undefined;
  const authors = Array.isArray(metadata?.authors)
    ? metadata.authors.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const language =
    typeof metadata?.language === "string" ? metadata.language : "zh-CN";
  const bookKey =
    typeof input.config.alias === "string"
      ? input.config.alias
      : String(input.bookId);
  const publicPageHref = (page: CompiledBook["pages"][number]) => {
    const pageKey = pageMetadata(compiled, page).alias ?? page.pageId;
    return `/read/${bookKey}/${pageKey}`;
  };
  const previewPageHref = (page: CompiledBook["pages"][number]) =>
    `/api/manage/books/${input.bookId}/preview/${input.configRevision}/pages/${page.pageId}`;
  const diagnostics: SafeDiagnostic[] = [
    ...(input.preparationDiagnostics ?? []),
    ...input.resourceResolution.diagnostics,
  ];
  const styles = new Set<string>();
  let searchCursor: SearchRowCursor = {
    currentHeading: "",
    nextOrdinal: 0,
  };
  let searchFtsRowCount = 0;

  try {
    await manifestSpool.open();
    await searchSpool.open();
    for await (const rendered of renderPages({
      book: compiled,
      ...(input.renderPage ? { renderPage: input.renderPage } : {}),
      resourceResolution: input.resourceResolution,
      ...(input.signal ? { signal: input.signal } : {}),
    })) {
      assertNonBlockingDiagnostics(rendered.diagnostics);
      diagnostics.push(...rendered.diagnostics);
      if (rendered.css) styles.add(rendered.css);
      await atomicWriteFile(
        resolve(bodyDirectory, `${rendered.page.pageId}.html`),
        rendered.html,
        { mode: 0o600 },
      );
      await manifestSpool.writeMany([
        {
          kind: "manifest_page",
          page: buildManifestPageRecord(compiled, rendered.page),
        },
      ]);
      const search = buildSearchRowsForBlocks({
        authors,
        blocks: compiled.document.blocks,
        book: compiled,
        bookId: input.bookId,
        cursor: searchCursor,
        endIndex: rendered.page.blockRange.end,
        startIndex: rendered.page.blockRange.start,
        title: compiled.bookTitle,
        versionId: input.versionId,
      });
      searchCursor = search.cursor;
      await searchSpool.writeMany(
        search.rows.map((row) => ({ kind: "fts", row })),
      );
      searchFtsRowCount += search.rows.length;
      input.onPageRendered?.(rendered.ordinal + 1, compiled.pages.length);
    }
    const shortRows = buildSearchShortRows({
      authors,
      book: compiled,
      bookId: input.bookId,
      title: compiled.bookTitle,
      versionId: input.versionId,
    });
    await searchSpool.writeMany(
      shortRows.map((row) => ({ kind: "short", row })),
    );
    await manifestSpool.close();
    await searchSpool.close();

    const css = [...styles].sort().join("");
    let outputBytes = Buffer.byteLength(css);
    await atomicWriteFile(
      resolve(publishedDirectory, "styles/document.css"),
      css,
      { mode: 0o400 },
    );
    const navigationPage = (pageId: number) => {
      const page = compiled.pageById.get(pageId);
      if (!page) throw new Error("CANDIDATE_PAGE_MISSING");
      return page;
    };
    const previewToc = navigation.map((link) => ({
      ...link,
      href: `${previewPageHref(navigationPage(link.pageId))}#${link.blockId}`,
    }));
    const publicToc = navigation.map((link) => ({
      ...link,
      href: `${publicPageHref(navigationPage(link.pageId))}#${link.blockId}`,
    }));
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
      const routeNeutralBody = await readFile(
        resolve(bodyDirectory, `${page.pageId}.html`),
        "utf8",
      );
      const previewBody = materializeRouteNeutralHtml({
        headingHref(blockId) {
          const pageId = pageByHeading.get(blockId);
          if (!pageId) throw new Error("CANDIDATE_HEADING_PAGE_MISSING");
          const target = compiled.pageById.get(pageId);
          if (!target) throw new Error("CANDIDATE_PAGE_MISSING");
          return `${previewPageHref(target)}#${blockId}`;
        },
        html: routeNeutralBody,
        resourceUrl: (resourceId) =>
          `/api/manage/books/${input.bookId}/preview/${input.configRevision}/assets/${resourceId}`,
      });
      const publicBody = materializeRouteNeutralHtml({
        headingHref(blockId) {
          const pageId = pageByHeading.get(blockId);
          if (!pageId) throw new Error("CANDIDATE_HEADING_PAGE_MISSING");
          const target = compiled.pageById.get(pageId);
          if (!target) throw new Error("CANDIDATE_PAGE_MISSING");
          return `${publicPageHref(target)}#${blockId}`;
        },
        html: routeNeutralBody,
        resourceUrl: (resourceId) =>
          `/books/${input.bookId}/assets/${input.versionId}/${resourceId}`,
      });
      const common = {
        bookKey,
        bookTitle: compiled.bookTitle,
        currentHeadingId: outline.at(0)?.blockId ?? null,
        currentPageId: page.pageId,
        outline,
      };
      const previewHtml = renderReaderHtmlDocument({
        body: renderReaderShell({
          ...common,
          bodyHtml: previewBody,
          firstPageHref: previewPageHref(compiled.pages[0] ?? page),
          mode: "preview",
          nextHref: nextPage ? previewPageHref(nextPage) : null,
          originalDownloads: [],
          previousHref: previousPage ? previewPageHref(previousPage) : null,
          previewRevision: input.configRevision,
          toc: previewToc,
        }),
        css,
        language,
        title: pageMetadata(compiled, page).title,
      });
      const publicHtml = renderReaderHtmlDocument({
        body: renderReaderShell({
          ...common,
          bodyHtml: publicBody,
          firstPageHref: publicPageHref(compiled.pages[0] ?? page),
          mode: "published",
          nextHref: nextPage ? publicPageHref(nextPage) : null,
          originalDownloads: input.originalFiles.map((original) => ({
            href: `/books/${bookKey}/originals/${String(original.id)}`,
            label:
              String(original.role) === "mineru_zip"
                ? "下载原始 ZIP"
                : "下载原文件",
          })),
          previousHref: previousPage ? publicPageHref(previousPage) : null,
          toc: publicToc,
        }),
        canonicalPath: publicPageHref(page),
        css,
        language,
        title: pageMetadata(compiled, page).title,
      });
      outputBytes +=
        Buffer.byteLength(previewHtml) + Buffer.byteLength(publicHtml);
      await Promise.all([
        atomicWriteFile(
          resolve(previewDirectory, `pages/${page.pageId}.html`),
          previewHtml,
          { mode: 0o400 },
        ),
        atomicWriteFile(
          resolve(publishedDirectory, `pages/${page.pageId}.html`),
          publicHtml,
          { mode: 0o400 },
        ),
      ]);
    }
    return Object.freeze({
      diagnostics: Object.freeze(diagnostics),
      manifestPageCount: compiled.pages.length,
      outputBytes,
      pageByHeading,
      pageCount: compiled.pages.length,
      searchFtsRowCount,
      searchShortRowCount: shortRows.length,
    });
  } catch (error) {
    await Promise.all([manifestSpool.abort(), searchSpool.abort()]);
    throw error;
  } finally {
    await rm(bodyDirectory, { force: true, recursive: true });
  }
}
