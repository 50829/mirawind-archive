import type { SafeDiagnostic } from "@/domain/errors";
import type {
  CompiledBook,
  PagePlan,
} from "@/modules/publishing/core/publication/compiled-book";
import { documentForPage } from "@/modules/publishing/core/publication/compiled-book";
import {
  renderSemanticDocument,
  type RenderSemanticDocumentOptions,
  type SemanticRenderResult,
} from "@/modules/publishing/core/publication/render-document";
import type { ResourceResolution } from "@/modules/publishing/core/publication/resource-model";
import {
  routeNeutralHeadingHref,
  routeNeutralResourceUrl,
} from "@/modules/publishing/core/publication/route-neutral-links";

const maximumConcurrentPages = 4;

export interface RenderPageInput extends RenderSemanticDocumentOptions {
  readonly headingHref: (blockId: string) => string;
  readonly headingOverrides: NonNullable<
    RenderSemanticDocumentOptions["headingOverrides"]
  >;
  readonly page: PagePlan;
}

export interface RenderedPage {
  readonly css: string;
  readonly diagnostics: readonly SafeDiagnostic[];
  readonly html: string;
  readonly ordinal: number;
  readonly page: PagePlan;
}

export type PageRenderer = (
  input: RenderPageInput,
) => Promise<SemanticRenderResult>;

type RenderSettlement =
  | { readonly ok: true; readonly value: RenderedPage }
  | { readonly error: unknown; readonly ok: false };

function cancellationError(): DOMException {
  return new DOMException("Page rendering was cancelled", "AbortError");
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw cancellationError();
}

export async function* renderPages(input: {
  readonly book: CompiledBook;
  readonly renderPage?: PageRenderer;
  readonly resourceResolution: ResourceResolution;
  readonly signal?: AbortSignal;
}): AsyncIterable<RenderedPage> {
  throwIfCancelled(input.signal);
  const renderer: PageRenderer =
    input.renderPage ??
    ((options) =>
      renderSemanticDocument({
        document: options.document,
        headingHref: options.headingHref,
        headingLinkIndex: options.headingLinkIndex,
        headingOverrides: options.headingOverrides,
        publishedResourceUrl: options.publishedResourceUrl,
        resourceResolution: options.resourceResolution,
      }));
  const inFlight = new Map<number, Promise<RenderSettlement>>();
  let nextToStart = 0;

  const startPage = (ordinal: number): void => {
    const page = input.book.pages[ordinal];
    if (!page) return;
    const promise = Promise.resolve()
      .then(async () => {
        throwIfCancelled(input.signal);
        const rendered = await renderer({
          document: documentForPage(input.book, page),
          headingHref: routeNeutralHeadingHref,
          headingLinkIndex: input.book.headingLinkIndex,
          headingOverrides: input.book.headingOverrides,
          page,
          publishedResourceUrl: routeNeutralResourceUrl,
          resourceResolution: input.resourceResolution,
        });
        throwIfCancelled(input.signal);
        return Object.freeze({
          css: rendered.css,
          diagnostics: rendered.diagnostics,
          html: rendered.html,
          ordinal,
          page,
        });
      })
      .then<RenderSettlement, RenderSettlement>(
        (value) => Object.freeze({ ok: true, value }),
        (error: unknown) => Object.freeze({ error, ok: false }),
      );
    inFlight.set(ordinal, promise);
  };
  const fillWindow = (): void => {
    while (
      inFlight.size < maximumConcurrentPages &&
      nextToStart < input.book.pages.length
    ) {
      startPage(nextToStart);
      nextToStart += 1;
    }
  };

  fillWindow();
  for (let ordinal = 0; ordinal < input.book.pages.length; ordinal += 1) {
    const pending = inFlight.get(ordinal);
    if (!pending) throw new Error("PAGE_RENDER_WINDOW_INVALID");
    const settlement = await pending;
    inFlight.delete(ordinal);
    fillWindow();
    if (!settlement.ok) throw settlement.error;
    throwIfCancelled(input.signal);
    yield settlement.value;
  }
}
