# Publishing Core Contract

## Public Build Surface

```ts
interface BuildCandidateCommand {
  readonly jobId: string;
  readonly candidateId: string;
  readonly versionId: string;
  readonly bookId: number;
  readonly sourceId: string;
  readonly configRevision: number;
  readonly capturedCurrentVersionId: string | null;
  readonly sourceRootRelativePath: string;
  readonly configRelativePath: string;
  readonly compilerIdentity: "compiler-v5";
  readonly rendererIdentity: "semantic-html-v5-katex-0.18.1";
  readonly previewIdentity: "draft-preview-v5";
  readonly readerIdentity: "mirawind-reader-v2-tailwind-4.3.3";
}

interface PagePlan {
  readonly blockRange: { readonly start: number; readonly end: number };
  readonly firstBlockId: string;
  readonly pageId: number;
  readonly rootRange: { readonly start: number; readonly end: number };
}

interface CompiledBook {
  readonly pages: readonly PagePlan[];
  // The parsed document, configured headings, lookup maps and semantic identity
  // are immutable whole-book values. Adapters and route policy are forbidden.
}

interface RenderedPage {
  readonly css: string;
  readonly diagnostics: readonly PublishingDiagnostic[];
  readonly html: string;
  readonly ordinal: number;
  readonly page: PagePlan;
}

interface CompileBookInput {
  readonly config: Readonly<Record<string, unknown>>;
  readonly configSha256: string;
  readonly markdownBytes: Uint8Array;
}

declare function compileBook(input: CompileBookInput): CompiledBook;
declare function renderPages(input: {
  readonly book: CompiledBook;
  readonly resourceResolution: ResourceResolution;
  readonly signal?: AbortSignal;
}): AsyncIterable<RenderedPage>;
```

`BuildCandidateCommand` is the application/worker boundary. Its adapter validates and loads the
authoritative bytes before calling the pure `compileBook()` function, then consumes `renderPages()`
and returns `CandidateBuildArtifact`. Rendered HTML uses validated logical heading/resource tokens
rather than preview/public URLs and does not expose intermediate analysis/layout/output types.

## Execution Invariants

- Parsing and content analysis occur once per command.
- `PagePlan` covers every included root block exactly once and carries no copied page AST.
- `renderPages` yields strict ordinal order with at most four render operations in flight.
- Cancellation prevents new scheduling and discards buffered pages after the current safe boundary.
- Diagnostics are deterministic independent of completion timing.
- Preview/public materialization and search/manifest spooling cannot mutate `CompiledBook` or
  `RenderedPage`.
- No core module imports React, Astro, SQLite, filesystem, process, HTTP or module adapters.

## Child Result

`CandidateBuildArtifact` includes IDs, relative artifact root, digests, all four build/reader
identities and bounded counts.
Its validator rejects unknown fields, unsafe paths, non-finite counts, identity mismatch and strings
beyond their declared limit. The parent reads full derived files only from the validated candidate
tree, never from IPC.
