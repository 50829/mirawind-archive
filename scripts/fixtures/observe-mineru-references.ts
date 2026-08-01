import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { extractZipFile } from "../../src/modules/publishing/adapters/filesystem/extract-archive.js";
import { readMineruLayoutEvidence } from "../../src/modules/publishing/adapters/filesystem/read-layout-evidence.js";
import { supplementMissingListPageLabels } from "../../src/modules/publishing/core/preparation/layout-evidence.js";
import { normalizeDocumentBlocks } from "../../src/modules/publishing/core/preparation/normalize-document.js";
import { normalizeMineruPreformattedMarkdown } from "../../src/modules/publishing/core/preparation/mineru-preformatted.js";
import { parseMarkdownDocument } from "../../src/modules/publishing/core/preparation/parse-markdown.js";
import { readPdfContentsEvidence } from "../../src/modules/publishing/adapters/filesystem/read-pdf-contents-evidence.js";
import {
  detectPrintedContents,
  inferPrintedHeadingEvidence,
  requiresSupplementalPdfEvidence,
  shouldUseNativePdfDetection,
  supplementalPdfPageIndices,
  type PrintedContentsCandidate,
} from "../../src/modules/publishing/core/preparation/printed-contents.js";
import {
  firstActiveHeadingAfterSourceRegion,
  prepareActiveDocument,
  type PreparedDocument,
} from "../../src/modules/publishing/core/preparation/prepared-document.js";
import { SourceTextIndex } from "../../src/modules/publishing/core/preparation/source-text-index.js";
import {
  proposeDocumentStructure,
  type ContentRole,
} from "../../src/modules/publishing/core/preparation/structure-proposal.js";
import type { NormalizedDocument } from "../../src/modules/publishing/core/preparation/document-model.js";
import {
  findTypographyProtectedRanges,
  preprocessMarkdownTypography,
} from "../../src/modules/publishing/core/preparation/typography.js";
import { resolveContainedPath } from "../../src/platform/filesystem/layout.js";
import type { MineruReferencePack } from "./create-mineru-reference-pack.js";
import type {
  ObservedMineruOutcome,
  ObservedProtectedRange,
} from "./compare-mineru-references.js";
import type {
  ReferenceAnchor,
  ReferenceContentsEntry,
  ReferenceContentsRegion,
  ReferenceExpectedDiagnostic,
  ReferenceHeadingAccounting,
  ReferenceSemanticKind,
} from "./mineru-reference-v2.js";
import { verifyRealMineruFixtures } from "./verify-real-mineru.js";

interface RootRange {
  readonly end: number;
  readonly rootIndex: number;
  readonly start: number;
}

interface CandidateProjection {
  readonly candidate: PrintedContentsCandidate;
  readonly endRoot: number;
  readonly entries: readonly ReferenceContentsEntry[];
  readonly key: string;
  readonly pages: readonly number[];
  readonly startRoot: number;
}

const frontmatter =
  /^(?:序|序言|前言|中文版序(?:[0-9零〇一二三四五六七八九十]+)?|第\s*[0-9零〇一二三四五六七八九十百千]+\s*版\s*前言|译者序|致学生|致教师|出版者的话|关于作者|专家指导委员会|作者简介|译者简介|教学建议|preface(?:\s+to\s+(?:the\s+)?[\p{L}\p{N} -]+\s+edition)?|foreword|prologue)$/iu;
const backmatter =
  /^(?:参考文献|参考资料|(?:表|图|主题|作者)?索引|(?:译)?后记|致谢|术语表|图片来源|符号索引|bibliography|references|(?:author|subject)\s+index|index|afterword|acknowledg(?:e)?ments?|credits)$/iu;
const contentsLabel =
  /^(?:(?:目\s*录|简\s*(?:明\s*)?目(?:\s*录)?)(?:\s+(?:brief\s+contents|contents))?|(?:brief\s+contents|contents|table\s+of\s+contents)(?:\s+(?:目\s*录|简\s*(?:明\s*)?目(?:\s*录)?))?)$/iu;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalize(value: string): string {
  return value
    .normalize("NFC")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/u, "")
    .replace(/[*_`]/gu, "")
    .replace(/\\([\\`*_{}[\]()#+.!-])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim();
}

export function stripPageLabel(value: string): {
  readonly pageLabel: string | null;
  readonly title: string;
} {
  const text = normalize(value);
  if (
    /^(?:chapter|part)\s+(?:[0-9ivxlcdm]+|[A-Z])\s+.*\b(?:windows|macos|android)\s+\d+\s*$/iu.test(
      text,
    )
  ) {
    return Object.freeze({ pageLabel: null, title: text });
  }
  if (/^(?:chapter|part)\s+(?:\d+|[ivxlcdm]+)$/iu.test(text)) {
    return Object.freeze({ pageLabel: null, title: text });
  }
  const match =
    /^(?<title>.+?)(?:\.(?:\s*\.)+|…+|·(?:\s*·)+|\s{2,}|\s)\s*(?<page>[ivxlcdm]+|\d{1,5})\s*$/iu.exec(
      text,
    ) ?? /^(?<title>.+[)\]}>])(?<page>\d{1,5})\s*$/u.exec(text);
  if (!match?.groups?.title || !match.groups.page) {
    return Object.freeze({ pageLabel: null, title: text });
  }
  const title = match.groups.title.trim();
  if (
    (title.length < 2 && !/^\p{Script=Han}$/u.test(title)) ||
    /^(?:chapter|part|第\s*\d+\s*(?:章|部分))$/iu.test(title)
  ) {
    return Object.freeze({ pageLabel: null, title: text });
  }
  return Object.freeze({ pageLabel: match.groups.page, title });
}

function comparison(value: string): string {
  return stripPageLabel(value)
    .title.normalize("NFKC")
    .replace(
      /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|part)\s*[0-9ivxlcdm]+|附录\s*[A-Za-z0-9一二三四五六七八九十]*|[A-Z]?\d+(?:\.\d+){0,3})\s*/iu,
      "",
    )
    .replace(/[\p{P}\p{S}\s]/gu, "")
    .toLocaleLowerCase("und");
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const pairs = (value: string): Map<string, number> => {
    const result = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const key = value.slice(index, index + 2);
      result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
  };
  const first = pairs(left);
  const second = pairs(right);
  let overlap = 0;
  for (const [key, count] of first)
    overlap += Math.min(count, second.get(key) ?? 0);
  return (2 * overlap) / (left.length + right.length - 2);
}

function rootRanges(document: NormalizedDocument): readonly RootRange[] {
  const sourceIndex = new SourceTextIndex(document.source);
  return Object.freeze(
    (document.root.children ?? []).map((root, rootIndex) => {
      const start = root.position?.start.offset;
      const end = root.position?.end.offset;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        throw new Error("OBSERVED_REFERENCE_ROOT_POSITION_MISSING");
      }
      return Object.freeze({
        end: sourceIndex.byteOffsetAt(Number(end)),
        rootIndex,
        start: sourceIndex.byteOffsetAt(Number(start)),
      });
    }),
  );
}

function rootForRange(
  roots: readonly RootRange[],
  start: number,
  end: number,
): { readonly endRoot: number; readonly startRoot: number } {
  const first = roots.find((root) => root.start === start);
  const last = roots.find((root) => root.end === end);
  if (!first || !last || last.rootIndex < first.rootIndex) {
    throw new Error("OBSERVED_REFERENCE_REGION_NOT_ROOT_ALIGNED");
  }
  return Object.freeze({ endRoot: last.rootIndex, startRoot: first.rootIndex });
}

function headingAnchorByBlock(input: {
  readonly document: NormalizedDocument;
  readonly pack: MineruReferencePack;
  readonly sourceDocument: NormalizedDocument;
}): ReadonlyMap<string, ReferenceAnchor> {
  const roots = input.sourceDocument.root.children ?? [];
  const observed = input.pack.markdown_documents[0];
  if (!observed) throw new Error("OBSERVED_REFERENCE_MARKDOWN_MISSING");
  const observations = new Map(
    observed.headings.map((heading) => [heading.root_index, heading] as const),
  );
  const rootByStart = new Map(
    roots.map((root, rootIndex) => [root.position?.start.offset, rootIndex]),
  );
  const sourceAnchors = new Map<string, ReferenceAnchor>(
    input.sourceDocument.headings.flatMap((heading) => {
      const rootIndex = rootByStart.get(heading.position?.start.offset);
      if (rootIndex === undefined) return [];
      const source = observations.get(rootIndex);
      return source
        ? [[heading.blockId, { root_index: rootIndex, sha256: source.sha256 }]]
        : [];
    }),
  );
  const result = new Map<string, ReferenceAnchor>();
  let sourceIndex = 0;
  for (const heading of input.document.headings) {
    let matched = false;
    while (sourceIndex < input.sourceDocument.headings.length) {
      const sourceHeading = input.sourceDocument.headings[sourceIndex++];
      if (
        !sourceHeading ||
        sourceHeading.level !== heading.level ||
        sourceHeading.sourceTitle !== heading.sourceTitle
      ) {
        continue;
      }
      const anchor = sourceAnchors.get(sourceHeading.blockId);
      if (!anchor) throw new Error("OBSERVED_REFERENCE_HEADING_ANCHOR_MISSING");
      result.set(heading.blockId, anchor);
      matched = true;
      break;
    }
    if (!matched)
      throw new Error("OBSERVED_REFERENCE_HEADING_ALIGNMENT_INVALID");
  }
  return result;
}

function kindFor(
  title: string,
  level: number,
  beforeFirstBodyUnit: boolean,
): ReferenceSemanticKind {
  const evidence = inferPrintedHeadingEvidence(title);
  if (evidence?.kind === "part") return "part";
  if (evidence?.kind === "chapter") return "chapter";
  if (evidence?.kind === "appendix") return "appendix";
  if (evidence?.kind === "decimal") return "section";
  if (frontmatter.test(title)) return "frontmatter";
  if (
    beforeFirstBodyUnit &&
    /^(?:致谢|acknowledg(?:e)?ments?)$/iu.test(title)
  ) {
    return "frontmatter";
  }
  if (backmatter.test(title)) return level > 1 ? "other" : "backmatter";
  return "other";
}

function pageRows(input: {
  readonly layout: Awaited<ReturnType<typeof readMineruLayoutEvidence>>;
}): readonly {
  readonly contentsLabel: boolean;
  readonly page: number;
  readonly printedPageLabel: boolean;
  readonly title: string;
}[] {
  return Object.freeze(
    input.layout.records.flatMap((record) => {
      if (!record.text) return [];
      return [
        Object.freeze({
          contentsLabel: contentsLabel.test(normalize(record.text)),
          page: record.pageIndex,
          printedPageLabel: stripPageLabel(record.text).pageLabel !== null,
          title: comparison(record.text),
        }),
      ];
    }),
  );
}

function pagesForEntries(input: {
  readonly entries: readonly ReferenceContentsEntry[];
  readonly rows: readonly {
    readonly contentsLabel: boolean;
    readonly page: number;
    readonly printedPageLabel: boolean;
    readonly title: string;
  }[];
  readonly startCursor: number;
}): { readonly cursor: number; readonly pages: readonly number[] } {
  const firstLabelIndex = input.rows.findIndex(
    (row, index) => index >= input.startCursor && row.contentsLabel,
  );
  if (firstLabelIndex >= 0) {
    const firstLabel = input.rows[firstLabelIndex];
    if (firstLabel) {
      let previousLabelPage = firstLabel.page;
      let nextLabelIndex = -1;
      for (
        let index = firstLabelIndex + 1;
        index < input.rows.length;
        index++
      ) {
        const row = input.rows[index];
        if (!row?.contentsLabel || row.page <= firstLabel.page) continue;
        if (
          row.title !== firstLabel.title ||
          row.page > previousLabelPage + 2
        ) {
          nextLabelIndex = index;
          break;
        }
        previousLabelPage = row.page;
      }
      const nextLabel =
        nextLabelIndex >= 0 ? input.rows[nextLabelIndex] : undefined;
      if (nextLabel) {
        return Object.freeze({
          cursor: nextLabelIndex,
          pages: Object.freeze(
            [
              ...new Set(
                input.rows
                  .slice(firstLabelIndex, nextLabelIndex)
                  .map((row) => row.page),
              ),
            ].sort((left, right) => left - right),
          ),
        });
      }

      const pageCounts = new Map<number, number>();
      for (const row of input.rows.slice(firstLabelIndex)) {
        if (!row.printedPageLabel) continue;
        pageCounts.set(row.page, (pageCounts.get(row.page) ?? 0) + 1);
      }
      const firstPageCount = pageCounts.get(firstLabel.page) ?? 0;
      const minimumCount = Math.max(2, Math.ceil(firstPageCount * 0.2));
      const pages: number[] = [];
      let accumulatedLabels = 0;
      for (let page = firstLabel.page; ; page += 1) {
        const count = pageCounts.get(page) ?? 0;
        if (page === firstLabel.page || count >= minimumCount) {
          pages.push(page);
          accumulatedLabels += count;
          if (accumulatedLabels >= input.entries.length * 0.9) break;
          continue;
        }
        break;
      }
      if (pages.length > 0) {
        const lastPage = pages.at(-1) ?? firstLabel.page;
        const lastIndex = input.rows.findLastIndex(
          (row, index) => index >= firstLabelIndex && row.page === lastPage,
        );
        return Object.freeze({
          cursor: lastIndex >= 0 ? lastIndex + 1 : firstLabelIndex + 1,
          pages: Object.freeze(pages),
        });
      }
    }
  }

  const expectedTitles = new Set(
    input.entries.map((entry) => comparison(entry.title)),
  );
  const printedMatches = new Map<number, number>();
  for (const row of input.rows.slice(input.startCursor)) {
    if (!row.printedPageLabel || !expectedTitles.has(row.title)) continue;
    printedMatches.set(row.page, (printedMatches.get(row.page) ?? 0) + 1);
  }
  if (printedMatches.size > 0) {
    const maximumMatches = Math.max(...printedMatches.values());
    const threshold = Math.max(1, Math.ceil(maximumMatches * 0.2));
    const eligiblePages = [...printedMatches]
      .filter(([, count]) => count >= threshold)
      .map(([page]) => page)
      .sort((left, right) => left - right);
    const runs: number[][] = [];
    for (const page of eligiblePages) {
      const run = runs.at(-1);
      if (!run || page > (run.at(-1) ?? page) + 1) runs.push([page]);
      else run.push(page);
    }
    const selected = runs.sort((left, right) => {
      const score = (pages: readonly number[]) =>
        pages.reduce((sum, page) => sum + (printedMatches.get(page) ?? 0), 0);
      return score(right) - score(left) || (left[0] ?? 0) - (right[0] ?? 0);
    })[0];
    if (selected && selected.length > 0) {
      const lastPage = selected.at(-1) ?? -1;
      const lastIndex = input.rows.findLastIndex(
        (row, index) => index >= input.startCursor && row.page === lastPage,
      );
      return Object.freeze({
        cursor: lastIndex >= 0 ? lastIndex + 1 : input.startCursor,
        pages: Object.freeze(selected),
      });
    }
  }
  let cursor = input.startCursor;
  const pages = new Set<number>();
  for (const entry of input.entries) {
    const expected = comparison(entry.title);
    let selected = -1;
    let selectedScore = 0;
    for (let index = cursor; index < input.rows.length; index += 1) {
      const row = input.rows[index];
      if (!row) continue;
      const score = similarity(expected, row.title);
      if (score > selectedScore) {
        selected = index;
        selectedScore = score;
      }
      if (score >= 0.96) break;
      if (index - cursor > 200) break;
    }
    if (selected >= 0 && selectedScore >= 0.55) {
      const row = input.rows[selected];
      if (row) pages.add(row.page);
      cursor = selected + 1;
    }
  }
  return Object.freeze({
    cursor,
    pages: Object.freeze([...pages].sort((left, right) => left - right)),
  });
}

function projectCandidates(input: {
  readonly candidates: readonly PrintedContentsCandidate[];
  readonly document: NormalizedDocument;
  readonly headingAnchors: ReadonlyMap<string, ReferenceAnchor>;
  readonly layout: Awaited<ReturnType<typeof readMineruLayoutEvidence>>;
}): readonly CandidateProjection[] {
  const roots = rootRanges(input.document);
  const rows = pageRows({ layout: input.layout });
  const accepted = input.candidates.filter(
    (
      candidate,
    ): candidate is PrintedContentsCandidate & {
      readonly proposedRegion: NonNullable<
        PrintedContentsCandidate["proposedRegion"]
      >;
    } => candidate.proposedRegion !== undefined,
  );
  let rowCursor = 0;
  return Object.freeze(
    accepted.map((candidate, candidateIndex) => {
      const key =
        accepted.length === 2 && candidateIndex === 0
          ? "brief-contents"
          : "full-contents";
      const range = rootForRange(roots, candidate.startByte, candidate.endByte);
      const ambiguous = new Set(
        candidate.diagnostics.flatMap((diagnostic) => {
          if (diagnostic.code !== "PRINTED_TOC_AMBIGUOUS_MATCH") return [];
          const index = Number(/\/entries\/(\d+)$/u.exec(diagnostic.path)?.[1]);
          return Number.isSafeInteger(index) ? [index] : [];
        }),
      );
      const firstBodyEntryIndex = candidate.logicalEntries.findIndex(
        (entry) => {
          const kind = inferPrintedHeadingEvidence(
            stripPageLabel(entry.sourceTitle).title,
          )?.kind;
          return kind === "part" || kind === "chapter";
        },
      );
      const entries = candidate.logicalEntries.map((entry, entryIndex) => {
        const printed = stripPageLabel(entry.sourceTitle);
        const anchor = entry.bodyHeadingBlockId
          ? (input.headingAnchors.get(entry.bodyHeadingBlockId) ?? null)
          : null;
        return Object.freeze({
          body_heading_anchor: anchor,
          entry_key: `${key}-entry-${String(entryIndex + 1).padStart(5, "0")}`,
          expected_match: anchor
            ? "matched"
            : ambiguous.has(entryIndex)
              ? "ambiguous"
              : "unmatched",
          kind: kindFor(
            printed.title,
            entry.referenceLevel,
            firstBodyEntryIndex >= 0 && entryIndex < firstBodyEntryIndex,
          ),
          level: entry.referenceLevel,
          page_label: printed.pageLabel,
          title: printed.title,
        }) as ReferenceContentsEntry;
      });
      const directPages = [
        ...new Set(
          candidate.logicalEntries.flatMap((entry) =>
            entry.pageIndex === undefined ? [] : [entry.pageIndex],
          ),
        ),
      ].sort((left, right) => left - right);
      const pageProjection =
        directPages.length > 0
          ? Object.freeze({
              cursor:
                rows.findLastIndex(
                  (row) => row.page <= (directPages.at(-1) ?? -1),
                ) + 1,
              pages: Object.freeze(directPages),
            })
          : pagesForEntries({
              entries,
              rows,
              startCursor: rowCursor,
            });
      rowCursor = pageProjection.cursor;
      return Object.freeze({
        candidate,
        endRoot: range.endRoot,
        entries: Object.freeze(entries),
        key,
        pages: pageProjection.pages,
        startRoot: range.startRoot,
      });
    }),
  );
}

function regionsFor(input: {
  readonly pack: MineruReferencePack;
  readonly projections: readonly CandidateProjection[];
}): readonly ReferenceContentsRegion[] {
  const markdown = input.pack.markdown_documents[0];
  if (!markdown) throw new Error("OBSERVED_REFERENCE_MARKDOWN_MISSING");
  return Object.freeze(
    input.projections.map((projection) => {
      const start = markdown.root_blocks[projection.startRoot];
      const end = markdown.root_blocks[projection.endRoot];
      if (!start || !end) throw new Error("OBSERVED_REFERENCE_ROOT_MISSING");
      return Object.freeze({
        canonical: projection.candidate.canonical,
        entries: projection.entries,
        markdown_range: Object.freeze({
          end: Object.freeze({
            root_index: end.root_index,
            sha256: end.sha256,
          }),
          start: Object.freeze({
            root_index: start.root_index,
            sha256: start.sha256,
          }),
        }),
        pdf_page_indices: projection.pages,
        region_key: projection.key,
      });
    }),
  );
}

function rawHeadingAccounting(input: {
  readonly headingAnchors: ReadonlyMap<string, ReferenceAnchor>;
  readonly originalDocument: NormalizedDocument;
  readonly preparedDocument: PreparedDocument;
  readonly projections: readonly CandidateProjection[];
  readonly regions: readonly ReferenceContentsRegion[];
}): readonly ReferenceHeadingAccounting[] {
  const canonicalRegion = input.projections.find(
    (projection) => projection.candidate.canonical,
  )?.candidate.proposedRegion;
  const bodySearchStartBlockId = canonicalRegion
    ? firstActiveHeadingAfterSourceRegion({
        preparedDocument: input.preparedDocument,
        region: canonicalRegion,
      })
    : undefined;
  const proposal = proposeDocumentStructure(input.preparedDocument.active, {
    ...(bodySearchStartBlockId ? { bodySearchStartBlockId } : {}),
    printedEntries: input.projections.flatMap((projection) =>
      projection.candidate.canonical
        ? projection.candidate.logicalEntries.map((entry) => ({
            ...(entry.bodyHeadingBlockId
              ? { bodyHeadingBlockId: entry.bodyHeadingBlockId }
              : {}),
            referenceLevel: entry.referenceLevel,
            sourceTitle: entry.sourceTitle,
          }))
        : [],
    ),
  });
  const activeByBlock = new Map(
    proposal.nodes.map((node) => [node.block_id, node] as const),
  );
  const activeIndexByBlock = new Map(
    proposal.nodes.map((node, index) => [node.block_id, index] as const),
  );
  const bodyIndex =
    activeIndexByBlock.get(proposal.boundaries.body_start_block_id) ?? 0;
  const appendixIndex = proposal.boundaries.appendix_start_block_id
    ? activeIndexByBlock.get(proposal.boundaries.appendix_start_block_id)
    : undefined;
  const backmatterIndex = proposal.boundaries.backmatter_start_block_id
    ? activeIndexByBlock.get(proposal.boundaries.backmatter_start_block_id)
    : undefined;
  const roots = input.originalDocument.root.children ?? [];
  const rootByStart = new Map(
    roots.map((root, rootIndex) => [root.position?.start.offset, rootIndex]),
  );
  return Object.freeze(
    input.originalDocument.headings.flatMap<ReferenceHeadingAccounting>(
      (heading) => {
        const rootIndex = rootByStart.get(heading.position?.start.offset);
        const anchor = input.headingAnchors.get(heading.blockId);
        if (rootIndex === undefined || !anchor) {
          throw new Error("OBSERVED_REFERENCE_HEADING_ANCHOR_MISSING");
        }
        const projectionIndex = input.projections.findIndex(
          (projection) =>
            rootIndex >= projection.startRoot &&
            rootIndex <= projection.endRoot,
        );
        if (projectionIndex >= 0) {
          const region = input.regions[projectionIndex];
          if (!region) throw new Error("OBSERVED_REFERENCE_REGION_MISSING");
          return [
            Object.freeze({
              anchor,
              disposition: Object.freeze({
                kind: "excluded" as const,
                region_key: region.region_key,
              }),
            }),
          ];
        }
        const node = activeByBlock.get(heading.blockId);
        if (!node) return [];
        const activeIndex = activeIndexByBlock.get(node.block_id);
        if (activeIndex === undefined) {
          throw new Error("OBSERVED_REFERENCE_STRUCTURE_NODE_MISSING");
        }
        const currentRole: ContentRole =
          backmatterIndex !== undefined && activeIndex >= backmatterIndex
            ? "backmatter"
            : appendixIndex !== undefined && activeIndex >= appendixIndex
              ? "appendix"
              : activeIndex < bodyIndex
                ? "frontmatter"
                : "body";
        return [
          Object.freeze({
            anchor,
            disposition: Object.freeze({
              display_level: node.display_level,
              display_title: null,
              include_in_toc: node.include_in_toc,
              kind: "expected_body" as const,
              role: currentRole,
              starts_page: node.starts_page,
            }),
          }),
        ];
      },
    ),
  );
}

function diagnosticsFor(
  projections: readonly CandidateProjection[],
): readonly ReferenceExpectedDiagnostic[] {
  return Object.freeze(
    projections.flatMap((projection) =>
      projection.candidate.diagnostics.map((diagnostic) => {
        const entryIndex = Number(
          /\/entries\/(\d+)$/u.exec(diagnostic.path)?.[1],
        );
        const entry = Number.isSafeInteger(entryIndex)
          ? projection.entries[entryIndex]
          : undefined;
        return Object.freeze({
          code: diagnostic.code,
          location: entry
            ? Object.freeze({
                entry_key: entry.entry_key,
                kind: "entry" as const,
              })
            : Object.freeze({
                kind: "region" as const,
                region_key: projection.key,
              }),
          phase: diagnostic.code.includes("MATCH")
            ? ("matching" as const)
            : ("contents" as const),
          recovery: Object.freeze([
            diagnostic.blockId
              ? ("select_structure" as const)
              : ("reload" as const),
          ]),
          severity:
            diagnostic.code === "PRINTED_TOC_LOW_COVERAGE" ||
            diagnostic.code === "PRINTED_TOC_RICH_CONTENT"
              ? ("warning" as const)
              : ("info" as const),
        });
      }),
    ),
  );
}

function observedProtectedRanges(
  input: string,
  output: string,
): readonly ObservedProtectedRange[] {
  const inputBytes = Buffer.from(input, "utf8");
  const outputBytes = Buffer.from(output, "utf8");
  let outputCursor = 0;
  return Object.freeze(
    findTypographyProtectedRanges(input).map((range) => {
      const protectedInput = inputBytes.subarray(
        range.start_byte,
        range.end_byte,
      );
      const outputStart = outputBytes.indexOf(protectedInput, outputCursor);
      const protectedOutput =
        outputStart >= 0
          ? outputBytes.subarray(
              outputStart,
              outputStart + protectedInput.byteLength,
            )
          : outputBytes.subarray(
              outputCursor,
              Math.min(
                outputBytes.byteLength,
                outputCursor + protectedInput.byteLength,
              ),
            );
      if (outputStart >= 0) {
        outputCursor = outputStart + protectedInput.byteLength;
      }
      return Object.freeze({
        ...range,
        output_sha256: sha256(protectedOutput),
        sha256: sha256(protectedInput),
      });
    }),
  );
}

export async function observeRealMineruFixture(input: {
  readonly archivePath: string;
  readonly pack: MineruReferencePack;
  readonly stagingDirectory: string;
}): Promise<ObservedMineruOutcome> {
  await mkdir(input.stagingDirectory, { mode: 0o700, recursive: true });
  const extractedRoot = join(input.stagingDirectory, "extracted");
  await extractZipFile({
    archivePath: input.archivePath,
    destination: extractedRoot,
  });
  const markdown = input.pack.markdown_documents[0];
  const originalPdf = input.pack.pdf_documents.find((pdf) =>
    /_origin\.pdf$/iu.test(pdf.relative_path),
  );
  if (!markdown || input.pack.markdown_documents.length !== 1 || !originalPdf) {
    throw new Error("OBSERVED_REFERENCE_PRIMARY_INPUT_INVALID");
  }
  const markdownPath = await resolveContainedPath(
    extractedRoot,
    markdown.relative_path,
  );
  const rawSource = await readFile(markdownPath, "utf8");
  if (sha256(rawSource) !== markdown.input_sha256) {
    throw new Error("OBSERVED_REFERENCE_MARKDOWN_HASH_MISMATCH");
  }
  const typography = preprocessMarkdownTypography(rawSource, "zh-smart-v2");
  const sourceDocument = normalizeDocumentBlocks(
    parseMarkdownDocument(typography.markdown),
  );
  const analysisMarkdown = normalizeMineruPreformattedMarkdown(
    typography.markdown,
  );
  const analysisSourceSha256 = sha256(analysisMarkdown);
  const originalDocument = normalizeDocumentBlocks(
    parseMarkdownDocument(analysisMarkdown),
  );
  const headingAnchors = headingAnchorByBlock({
    document: originalDocument,
    pack: input.pack,
    sourceDocument,
  });
  const layout = await readMineruLayoutEvidence(markdownPath);
  let regionCounter = 0;
  let detection = detectPrintedContents({
    document: originalDocument,
    idFactory: () => `region_${String(++regionCounter).padStart(16, "0")}`,
    layoutEvidence: layout,
    sourcePath: basename(markdown.relative_path),
    sourceSha256: analysisSourceSha256,
  });
  if (requiresSupplementalPdfEvidence(detection)) {
    const hasHighBoundary = detection.candidates.some(
      (candidate) => candidate.boundaryConfidence === "high",
    );
    const requiresLineRepair = detection.candidates.some(
      (candidate) =>
        candidate.proposedRegion !== undefined && candidate.requiresPdfEvidence,
    );
    const pdfPath = await resolveContainedPath(
      extractedRoot,
      originalPdf.relative_path,
    );
    const pageIndices = supplementalPdfPageIndices(detection);
    const pdfEvidence = await readPdfContentsEvidence({
      allowOcr: !hasHighBoundary || requiresLineRepair,
      ...(pageIndices ? { pageIndices } : {}),
      pdfPath,
      recoverPageLabels: requiresLineRepair,
      temporaryRoot: input.stagingDirectory,
    });
    if (pdfEvidence.records.length > 0) {
      const pdfLayout = Object.freeze({
        diagnostics: layout.diagnostics,
        records: pdfEvidence.records,
        source: pdfEvidence.source,
      });
      const repairedLayout = supplementMissingListPageLabels(layout, pdfLayout);
      regionCounter = 0;
      const repairedDetection = detectPrintedContents({
        document: originalDocument,
        idFactory: () => `region_${String(++regionCounter).padStart(16, "0")}`,
        layoutEvidence: repairedLayout,
        sourcePath: basename(markdown.relative_path),
        sourceSha256: analysisSourceSha256,
      });
      regionCounter = 0;
      const nativeDetection = detectPrintedContents({
        document: originalDocument,
        idFactory: () => `region_${String(++regionCounter).padStart(16, "0")}`,
        layoutEvidence: pdfLayout,
        sourcePath: basename(markdown.relative_path),
        sourceSha256: analysisSourceSha256,
      });
      const preferNative = shouldUseNativePdfDetection({
        nativeDetection,
        nativeLayout: pdfLayout,
        sourceDetection: repairedDetection,
        sourceLayout: repairedLayout,
      });
      detection = preferNative ? nativeDetection : repairedDetection;
    }
  }
  const projections = projectCandidates({
    candidates: detection.candidates,
    document: originalDocument,
    headingAnchors,
    layout,
  });
  const sourceRegions = projections.flatMap((projection) =>
    projection.candidate.proposedRegion
      ? [projection.candidate.proposedRegion]
      : [],
  );
  const preparedDocument = prepareActiveDocument({
    cleanupInputSha256: typography.provenance.output_sha256,
    document: originalDocument,
    mainMarkdownPath: basename(markdown.relative_path),
    mainMarkdownSha256: analysisSourceSha256,
    regions: sourceRegions,
  });
  const regions = regionsFor({ pack: input.pack, projections });
  return Object.freeze({
    archive_sha256: input.pack.archive_sha256,
    diagnostics: diagnosticsFor(projections),
    fixture_id: input.pack.fixture_id,
    main_markdown: Object.freeze({
      input_sha256: markdown.input_sha256,
      relative_path: markdown.relative_path,
    }),
    original_pdf: Object.freeze({
      page_count: originalPdf.page_count,
      relative_path: originalPdf.relative_path,
      sha256: originalPdf.sha256,
    }),
    printed_contents: Object.freeze({
      regions,
      state: regions.length > 0 ? "present" : "absent",
    }),
    protected_ranges: observedProtectedRanges(rawSource, typography.markdown),
    raw_heading_accounting: rawHeadingAccounting({
      headingAnchors,
      originalDocument,
      preparedDocument,
      projections,
      regions,
    }),
  });
}

export async function observeRealMineruSet(input: {
  readonly fixtureIds?: readonly string[];
  readonly outputDirectory: string;
  readonly realDirectory: string;
}): Promise<
  readonly { readonly fixture_id: string; readonly regions: number }[]
> {
  const root = resolve(input.realDirectory);
  const fixtures = await verifyRealMineruFixtures(
    root,
    undefined,
    input.fixtureIds,
  );
  const outputDirectory = resolve(input.outputDirectory);
  await mkdir(outputDirectory, { mode: 0o700, recursive: true });
  const summaries = [];
  for (const fixture of fixtures) {
    const pack = JSON.parse(
      await readFile(
        join(root, "reference-packs", fixture.id, "observations.json"),
        "utf8",
      ),
    ) as MineruReferencePack;
    if (
      pack.fixture_id !== fixture.id ||
      pack.archive_sha256 !== fixture.sha256
    ) {
      throw new Error("OBSERVED_REFERENCE_PACK_BINDING_MISMATCH");
    }
    const stagingDirectory = await mkdtemp(
      join(tmpdir(), "mirawind-observed-reference-"),
    );
    try {
      const observed = await observeRealMineruFixture({
        archivePath: join(root, fixture.fileName),
        pack,
        stagingDirectory,
      });
      await writeFile(
        join(outputDirectory, `${fixture.id}.json`),
        `${JSON.stringify(observed, null, 2)}\n`,
        { mode: 0o600 },
      );
      summaries.push(
        Object.freeze({
          fixture_id: fixture.id,
          regions: observed.printed_contents.regions.length,
        }),
      );
      process.stderr.write(
        `${JSON.stringify({ fixture_id: fixture.id, regions: observed.printed_contents.regions.length })}\n`,
      );
    } finally {
      await rm(stagingDirectory, { force: true, recursive: true });
    }
  }
  return Object.freeze(summaries);
}

function parseArguments(arguments_: readonly string[]): {
  readonly fixtureIds: readonly string[];
  readonly outputDirectory: string;
  readonly realDirectory: string;
} {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const values = new Map<string, string>();
  const fixtureIds: string[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    const value = normalized[index + 1];
    if (
      !name ||
      !value ||
      !["--fixture", "--output", "--real-dir"].includes(name) ||
      (name !== "--fixture" && values.has(name))
    ) {
      throw new Error("Arguments must be --name value pairs");
    }
    if (name === "--fixture") fixtureIds.push(value);
    else values.set(name, value);
  }
  const outputDirectory = values.get("--output");
  const realDirectory = values.get("--real-dir");
  if (!outputDirectory || !realDirectory) {
    throw new Error("Required: --real-dir --output");
  }
  return Object.freeze({
    fixtureIds: Object.freeze(fixtureIds),
    outputDirectory,
    realDirectory,
  });
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const fixtures = await observeRealMineruSet({
    ...(arguments_.fixtureIds.length > 0
      ? { fixtureIds: arguments_.fixtureIds }
      : {}),
    outputDirectory: arguments_.outputDirectory,
    realDirectory: arguments_.realDirectory,
  });
  process.stdout.write(`${JSON.stringify({ fixtures, ok: true })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
