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
  readonly id: number;
  readonly ordinal: number;
  readonly startBlockIndex: number;
  readonly endBlockIndexExclusive: number;
}

interface CompiledBook {
  readonly pages: readonly PagePlan[];
  // Document, configured headings, resources, identities and diagnostics are
  // immutable whole-book values; adapters and route policy are forbidden.
}

interface RouteNeutralReaderPageModel {
  readonly pageId: number;
  readonly title: string;
  readonly toc: readonly NavigationNode[];
  readonly breadcrumbs: readonly NavigationNode[];
  readonly outline: readonly NavigationNode[];
  readonly articleHtml: string;
  readonly logicalResourceIds: readonly string[];
  readonly previousPageId: number | null;
  readonly nextPageId: number | null;
}

interface RenderedPage {
  readonly pageId: number;
  readonly ordinal: number;
  readonly model: RouteNeutralReaderPageModel;
  readonly requiredRendererAssetIds: readonly string[];
  readonly diagnostics: readonly PublishingDiagnostic[];
  readonly searchRows: readonly SearchRow[];
}

declare function compileBook(
  input: BuildCandidateCommand,
): Promise<CompiledBook>;
declare function renderPages(book: CompiledBook): AsyncIterable<RenderedPage>;
```

`NavigationNode`, `PublishingDiagnostic` and `SearchRow` reuse the existing strict shared DTOs. The
`articleHtml` uses validated logical resource tokens rather than preview/public URLs. The model stays
serializable into both ReaderShell materializers and does not expose intermediate
analysis/layout/output types.

## Execution Invariants

- Parsing and content analysis occur once per command.
- `PagePlan` covers every included root block exactly once and carries no copied page AST.
- `renderPages` yields strict ordinal order with at most four render operations in flight.
- Cancellation prevents new scheduling and discards buffered pages after the current safe boundary.
- Diagnostics are deterministic independent of completion timing.
- Preview/public materialization cannot mutate `CompiledBook` or `RenderedPage`.
- No core module imports React, Astro, SQLite, filesystem, process, HTTP or module adapters.

## Child Result

`CandidateBuildArtifact` includes IDs, relative artifact root, digests, all four build/reader
identities and bounded counts.
Its validator rejects unknown fields, unsafe paths, non-finite counts, identity mismatch and strings
beyond their declared limit. The parent reads full derived files only from the validated candidate
tree, never from IPC.
