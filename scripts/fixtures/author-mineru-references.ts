import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { extractZipFile } from "../../src/compiler/archive/extractor.js";
import { parseMarkdownDocument } from "../../src/compiler/document/parser.js";
import { resolveContainedPath } from "../../src/storage/layout.js";
import type { MineruReferencePack } from "./create-mineru-reference-pack.js";
import {
  parseMineruReferenceV2,
  type MineruReferenceV2,
  type ReferenceAnchor,
  type ReferenceContentsEntry,
  type ReferenceHeadingAccounting,
  type ReferenceSemanticKind,
} from "./mineru-reference-v2.js";
import {
  parseRealFixtureManifest,
  verifyRealMineruFixtures,
} from "./verify-real-mineru.js";

export interface VisionRegionDecision {
  readonly canonical: boolean;
  readonly end_root: number;
  readonly pdf_page_indices: readonly number[];
  readonly region_key: string;
  readonly start_root: number;
}

export interface VisionFixtureDecision {
  readonly fixture_id: string;
  readonly printed_contents:
    | { readonly state: "absent" }
    | {
        readonly regions: readonly VisionRegionDecision[];
        readonly state: "present";
      };
}

export interface VisionDecisionSet {
  readonly fixtures: readonly VisionFixtureDecision[];
  readonly schema_version: 1;
}

export interface CodexVisionTranscript {
  readonly fixture_id: string;
  readonly inspected_pages: readonly {
    readonly page_index: number;
    readonly sha256: string;
  }[];
  readonly regions: readonly {
    readonly canonical: boolean;
    readonly end_root: number;
    readonly entries: readonly {
      readonly entry_key: string;
      readonly kind: ReferenceSemanticKind;
      readonly level: number;
      readonly page_label: string | null;
      readonly title: string;
    }[];
    readonly pdf_page_indices: readonly number[];
    readonly region_key: string;
    readonly start_root: number;
  }[];
  readonly schema_version: 1;
  readonly source: "codex-image-recognition";
}

export interface VisionTranscriptTemplate extends Omit<
  CodexVisionTranscript,
  "source"
> {
  readonly source: "unverified-markdown-template";
}

interface RootText {
  readonly rootIndex: number;
  readonly text: string;
  readonly type: string;
}

interface HeadingText extends RootText {
  readonly anchor: ReferenceAnchor;
  readonly depth: number;
}

interface ParsedEntry {
  readonly kind: ReferenceSemanticKind;
  readonly level: number;
  readonly pageLabel: string | null;
  readonly title: string;
}

const contentsLabel =
  /^(?:目\s*录|简\s*目|brief\s+contents|contents|table\s+of\s+contents)$/iu;
const backmatter =
  /^(?:参考文献|参考资料|索引|后记|致谢|术语表|图片来源|符号索引|bibliography|references|index|afterword|acknowledg(?:e)?ments?|credits)$/iu;
const frontmatter =
  /^(?:序|序言|前言|译者序|出版者的话|作者简介|preface|foreword|prologue)$/iu;
const auxiliary =
  /^(?:思考题|本章注记|附录注记|自测题|习题|练习|课后习题和问题|复习题|人物专访|编程作业|practice exercises|further reading|review questions|exercises)$/iu;
const localPartSubdivision =
  /^第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:篇|部分|部)\s*[（(]/u;

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function visibleText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as {
    readonly children?: readonly unknown[];
    readonly type?: unknown;
    readonly value?: unknown;
  };
  if (value.type === "break") return "\n";
  if (typeof value.value === "string") return value.value;
  return (value.children ?? []).map(visibleText).join("");
}

function normalizedLines(value: string): readonly string[] {
  return Object.freeze(value.split(/\n+/u).map(normalize).filter(Boolean));
}

function visibleLines(node: unknown): readonly string[] {
  if (!node || typeof node !== "object") return Object.freeze([]);
  const value = node as {
    readonly children?: readonly unknown[];
    readonly type?: unknown;
  };
  if (value.type === "list") {
    return Object.freeze(
      (value.children ?? []).flatMap((child) =>
        normalizedLines(visibleText(child)),
      ),
    );
  }
  if (value.type === "table") {
    return Object.freeze(
      (value.children ?? []).flatMap((row) =>
        normalizedLines(visibleText(row)),
      ),
    );
  }
  return normalizedLines(visibleText(node));
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function comparison(value: string): string {
  return normalize(value)
    .replace(
      /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|part)\s*[0-9ivxlcdm]+|附录\s*[A-Za-z0-9一二三四五六七八九十]*(?:\.\d+){0,3}|\d+[A-Z](?:\.\d+){0,2}|\d+(?:\.\d+){0,3})\s*/iu,
      "",
    )
    .replace(/[\p{P}\p{S}\s]/gu, "")
    .toLocaleLowerCase("und");
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const pairs = (value: string): Map<string, number> => {
    const output = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const key = value.slice(index, index + 2);
      output.set(key, (output.get(key) ?? 0) + 1);
    }
    return output;
  };
  const first = pairs(left);
  const second = pairs(right);
  let overlap = 0;
  for (const [key, count] of first) {
    overlap += Math.min(count, second.get(key) ?? 0);
  }
  return (2 * overlap) / (left.length + right.length - 2);
}

function stripPageLabel(value: string): {
  readonly pageLabel: string | null;
  readonly title: string;
} {
  const normalized = normalize(value);
  const match =
    /^(?<title>.+?)(?:\.(?:\s*\.)+|…+|·(?:\s*·)+|\s{2,}|\s)\s*(?<page>[ivxlcdm]+|\d{1,5})\s*$/iu.exec(
      normalized,
    );
  if (!match?.groups?.title || !match.groups.page) {
    return Object.freeze({ pageLabel: null, title: normalized });
  }
  const title = match.groups.title.trim();
  if (
    title.length < 2 ||
    /^(?:chapter|part|第\s*\d+\s*(?:章|部分))$/iu.test(title)
  ) {
    return Object.freeze({ pageLabel: null, title: normalized });
  }
  return Object.freeze({ pageLabel: match.groups.page, title });
}

function numberedKind(value: string):
  | {
      readonly depth: number;
      readonly kind: "appendix" | "chapter" | "part" | "section";
    }
  | undefined {
  const title = normalize(value).replace(/[．。]/gu, ".");
  const named =
    /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?<zh>章|篇|部分|部)|(?<chapter>chapter)\s*[0-9ivxlcdm]+|(?<part>part)\s*[0-9ivxlcdm]+|(?<appendix>附录|appendix)(?:\s*[A-Za-z0-9一二三四五六七八九十]*)?)/iu.exec(
      title,
    );
  if (named) {
    if (
      named.groups?.part ||
      ["篇", "部分", "部"].includes(named.groups?.zh ?? "")
    ) {
      return Object.freeze({ depth: 1, kind: "part" as const });
    }
    if (named.groups?.appendix) {
      return Object.freeze({ depth: 1, kind: "appendix" as const });
    }
    return Object.freeze({ depth: 1, kind: "chapter" as const });
  }
  const alpha = /^(?<number>\d+[A-Z](?:\.\d+){0,2})(?=\s|、|:|：)/iu.exec(title)
    ?.groups?.number;
  if (alpha) {
    return Object.freeze({
      depth: Math.min(4, 2 + (alpha.match(/\./gu)?.length ?? 0)),
      kind: "section" as const,
    });
  }
  const decimal = /^(?<number>\d+(?:\.\d+){0,3})(?=\s|、|:|：|\p{L})/iu.exec(
    title,
  )?.groups?.number;
  if (!decimal) return;
  const depth = decimal.includes(".") ? decimal.split(".").length : 1;
  return Object.freeze({
    depth,
    kind: depth === 1 ? ("chapter" as const) : ("section" as const),
  });
}

function entryFor(
  value: string,
  insidePart: boolean,
  previousLevel: number,
): ParsedEntry | undefined {
  const page = stripPageLabel(value);
  const title = page.title;
  if (!title || contentsLabel.test(title) || title.length > 500) return;
  const numbered = numberedKind(title);
  let kind: ReferenceSemanticKind;
  let level: number;
  if (numbered?.kind === "part") {
    kind = "part";
    level = 1;
  } else if (numbered?.kind === "appendix") {
    kind = "appendix";
    level = 1;
  } else if (numbered?.kind === "chapter") {
    kind = "chapter";
    level = insidePart ? 2 : 1;
  } else if (numbered?.kind === "section") {
    kind = "section";
    level = Math.min(4, numbered.depth + (insidePart ? 1 : 0));
  } else if (frontmatter.test(title)) {
    kind = "frontmatter";
    level = 1;
  } else if (backmatter.test(title)) {
    kind = "backmatter";
    level = 1;
  } else if (auxiliary.test(title)) {
    kind = "other";
    level = Math.min(4, Math.max(2, previousLevel));
  } else if (page.pageLabel) {
    kind = "other";
    level = Math.min(4, Math.max(1, previousLevel));
  } else {
    return;
  }
  return Object.freeze({ kind, level, pageLabel: page.pageLabel, title });
}

function rootsFrom(input: {
  readonly document: {
    readonly root: { readonly children?: readonly unknown[] };
  };
  readonly pack: MineruReferencePack;
}): {
  readonly headings: readonly HeadingText[];
  readonly roots: readonly RootText[];
} {
  const observed = input.pack.markdown_documents[0];
  if (!observed) throw new Error("VISION_REFERENCE_MARKDOWN_MISSING");
  const roots = (input.document.root.children ?? []).map((node, rootIndex) => {
    const typed = node as { readonly type?: unknown };
    return Object.freeze({
      rootIndex,
      text: visibleLines(node).join("\n"),
      type: typeof typed.type === "string" ? typed.type : "unknown",
    });
  });
  const headings = observed.headings.map((heading) =>
    Object.freeze({
      anchor: Object.freeze({
        root_index: heading.root_index,
        sha256: heading.sha256,
      }),
      depth: heading.depth,
      rootIndex: heading.root_index,
      text: normalize(heading.text),
      type: heading.type,
    }),
  );
  return Object.freeze({
    headings: Object.freeze(headings),
    roots: Object.freeze(roots),
  });
}

function regionEntries(
  roots: readonly RootText[],
  decision: VisionRegionDecision,
) {
  const values: ParsedEntry[] = [];
  let insidePart = false;
  let previousLevel = 0;
  for (
    let rootIndex = decision.start_root;
    rootIndex <= decision.end_root;
    rootIndex += 1
  ) {
    const root = roots[rootIndex];
    if (!root) throw new Error("VISION_REFERENCE_ROOT_OUTSIDE_DOCUMENT");
    const lines = root.text.split(/\n+/u).map(normalize).filter(Boolean);
    for (const line of lines) {
      const parsed = entryFor(line, insidePart, previousLevel);
      if (!parsed) continue;
      values.push(parsed);
      if (parsed.kind === "part") insidePart = true;
      else if (parsed.kind === "appendix" || parsed.kind === "backmatter")
        insidePart = false;
      previousLevel = parsed.level;
    }
  }
  if (values.length < 1)
    throw new Error("VISION_REFERENCE_REGION_HAS_NO_ENTRIES");
  return Object.freeze(values);
}

function pageImages(
  pack: MineruReferencePack,
  decision: VisionFixtureDecision,
) {
  const original = pack.pdf_documents.find((pdf) =>
    /_origin\.pdf$/iu.test(pdf.relative_path),
  );
  if (!original) throw new Error("VISION_REFERENCE_ORIGINAL_PDF_MISSING");
  const requested = new Set(
    decision.printed_contents.state === "present"
      ? decision.printed_contents.regions.flatMap(
          (region) => region.pdf_page_indices,
        )
      : original.rendered_pages.map((page) => page.page_index),
  );
  const pages = original.rendered_pages
    .filter((page) => requested.has(page.page_index))
    .map((page) =>
      Object.freeze({ page_index: page.page_index, sha256: page.sha256 }),
    );
  if (pages.length !== requested.size)
    throw new Error("VISION_REFERENCE_PAGE_NOT_RENDERED");
  return Object.freeze(pages);
}

export function createVisionTranscriptTemplate(input: {
  readonly decision: VisionFixtureDecision;
  readonly document: {
    readonly root: { readonly children?: readonly unknown[] };
  };
  readonly pack: MineruReferencePack;
}): VisionTranscriptTemplate {
  if (input.decision.fixture_id !== input.pack.fixture_id) {
    throw new Error("VISION_REFERENCE_FIXTURE_MISMATCH");
  }
  const { roots } = rootsFrom(input);
  const regions =
    input.decision.printed_contents.state === "absent"
      ? []
      : input.decision.printed_contents.regions.map((region) => {
          const entries = regionEntries(roots, region).map((entry, index) =>
            Object.freeze({
              entry_key: `${region.region_key}-entry-${String(index + 1).padStart(5, "0")}`,
              kind: entry.kind,
              level: entry.level,
              page_label: entry.pageLabel,
              title: entry.title,
            }),
          );
          return Object.freeze({
            canonical: region.canonical,
            end_root: region.end_root,
            entries: Object.freeze(entries),
            pdf_page_indices: Object.freeze([...region.pdf_page_indices]),
            region_key: region.region_key,
            start_root: region.start_root,
          });
        });
  return Object.freeze({
    fixture_id: input.pack.fixture_id,
    inspected_pages: pageImages(input.pack, input.decision),
    regions: Object.freeze(regions),
    schema_version: 1,
    source: "unverified-markdown-template",
  });
}

function parseCodexVisionTranscript(value: unknown): CodexVisionTranscript {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VISION_TRANSCRIPT_INVALID");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    input.schema_version !== 1 ||
    input.source !== "codex-image-recognition" ||
    typeof input.fixture_id !== "string" ||
    !Array.isArray(input.inspected_pages) ||
    !Array.isArray(input.regions) ||
    Object.keys(input).sort().join(",") !==
      "fixture_id,inspected_pages,regions,schema_version,source"
  ) {
    throw new Error("VISION_TRANSCRIPT_INVALID");
  }
  return input as unknown as CodexVisionTranscript;
}

function matchEntries(
  entries: CodexVisionTranscript["regions"][number]["entries"],
  headings: readonly HeadingText[],
): readonly ReferenceContentsEntry[] {
  const width = headings.length + 1;
  const cellCount = (entries.length + 1) * width;
  if (cellCount > 10_000_000) {
    throw new Error("VISION_REFERENCE_ALIGNMENT_LIMIT_EXCEEDED");
  }
  const scores = new Float64Array(cellCount);
  const actions = new Uint8Array(cellCount);
  const entrySkipCost = 3;
  const headingSkipCost = 0.01;
  for (let entryIndex = 1; entryIndex <= entries.length; entryIndex += 1) {
    scores[entryIndex * width] = -entrySkipCost * entryIndex;
    actions[entryIndex * width] = 1;
  }
  for (
    let headingIndex = 1;
    headingIndex <= headings.length;
    headingIndex += 1
  ) {
    scores[headingIndex] = -headingSkipCost * headingIndex;
    actions[headingIndex] = 2;
  }
  for (let entryIndex = 1; entryIndex <= entries.length; entryIndex += 1) {
    const entry = entries[entryIndex - 1];
    if (!entry) continue;
    const expected = comparison(entry.title);
    for (
      let headingIndex = 1;
      headingIndex <= headings.length;
      headingIndex += 1
    ) {
      const heading = headings[headingIndex - 1];
      if (!heading) continue;
      const offset = entryIndex * width + headingIndex;
      const similarityScore = similarity(expected, comparison(heading.text));
      const exactTitle =
        normalize(entry.title).toLocaleLowerCase("und") ===
        normalize(heading.text).toLocaleLowerCase("und");
      const matched =
        similarityScore < 0.62
          ? Number.NEGATIVE_INFINITY
          : (scores[offset - width - 1] ?? Number.NEGATIVE_INFINITY) +
            similarityScore * 10 +
            (exactTitle ? 5 : 0);
      const skipEntry =
        (scores[offset - width] ?? Number.NEGATIVE_INFINITY) - entrySkipCost;
      const skipHeading =
        (scores[offset - 1] ?? Number.NEGATIVE_INFINITY) - headingSkipCost;
      if (matched >= skipEntry && matched >= skipHeading) {
        scores[offset] = matched;
        actions[offset] = 3;
      } else if (skipEntry >= skipHeading) {
        scores[offset] = skipEntry;
        actions[offset] = 1;
      } else {
        scores[offset] = skipHeading;
        actions[offset] = 2;
      }
    }
  }
  const matchedHeadings = new Map<number, number>();
  let entryCursor = entries.length;
  let headingCursor = headings.length;
  while (entryCursor > 0 || headingCursor > 0) {
    const action = actions[entryCursor * width + headingCursor];
    if (action === 3) {
      matchedHeadings.set(entryCursor - 1, headingCursor - 1);
      entryCursor -= 1;
      headingCursor -= 1;
    } else if (action === 1 && entryCursor > 0) {
      entryCursor -= 1;
    } else if (headingCursor > 0) {
      headingCursor -= 1;
    } else {
      entryCursor -= 1;
    }
  }
  return Object.freeze(
    entries.map((entry, entryIndex) => {
      const headingIndex = matchedHeadings.get(entryIndex);
      const heading =
        headingIndex === undefined ? undefined : headings[headingIndex];
      return Object.freeze({
        body_heading_anchor: heading?.anchor ?? null,
        entry_key: entry.entry_key,
        expected_match: heading ? "matched" : "unmatched",
        kind: entry.kind,
        level: entry.level,
        page_label: entry.page_label,
        title: entry.title,
      }) as ReferenceContentsEntry;
    }),
  );
}

function roleFor(
  kind: ReferenceSemanticKind,
  current: "appendix" | "backmatter" | "body" | "frontmatter",
) {
  if (kind === "appendix") return "appendix" as const;
  if (kind === "backmatter") return "backmatter" as const;
  if (kind === "frontmatter") return "frontmatter" as const;
  return current === "frontmatter" ? ("body" as const) : current;
}

function headingAccounting(input: {
  readonly headings: readonly HeadingText[];
  readonly regions: MineruReferenceV2["printed_contents"]["regions"];
}): readonly ReferenceHeadingAccounting[] {
  const exclusions = input.regions.map((region) => ({
    end: region.markdown_range.end.root_index,
    key: region.region_key,
    start: region.markdown_range.start.root_index,
  }));
  const matched = new Map(
    input.regions.flatMap((region) =>
      region.entries.flatMap((entry) =>
        entry.body_heading_anchor
          ? [
              [
                `${entry.body_heading_anchor.root_index}:${entry.body_heading_anchor.sha256}`,
                entry,
              ] as const,
            ]
          : [],
      ),
    ),
  );
  let insidePart = false;
  let currentRole: "appendix" | "backmatter" | "body" | "frontmatter" =
    "frontmatter";
  let previousLevel = 0;
  let firstChapterInPart = false;
  return Object.freeze(
    input.headings.map((heading, index) => {
      const excluded = exclusions.find(
        (region) =>
          heading.rootIndex >= region.start && heading.rootIndex <= region.end,
      );
      if (excluded) {
        return Object.freeze({
          anchor: heading.anchor,
          disposition: Object.freeze({
            kind: "excluded" as const,
            region_key: excluded.key,
          }),
        });
      }
      const matchedEntry = matched.get(
        `${heading.anchor.root_index}:${heading.anchor.sha256}`,
      );
      const numbered = numberedKind(heading.text);
      const localPart = Boolean(
        !matchedEntry &&
        numbered?.kind === "part" &&
        localPartSubdivision.test(normalize(heading.text)),
      );
      const inferred = localPart
        ? undefined
        : entryFor(heading.text, insidePart, previousLevel);
      let kind =
        matchedEntry?.kind ?? (localPart ? "other" : inferred?.kind) ?? "other";
      if (
        !matchedEntry &&
        (kind === "backmatter" || kind === "frontmatter") &&
        previousLevel > 1
      ) {
        kind = "other";
      }
      let level = localPart
        ? 3
        : (matchedEntry?.level ??
          (kind === "other" && inferred?.kind !== "other"
            ? previousLevel
            : inferred?.level) ??
          Math.min(4, Math.max(1, previousLevel || heading.depth)));
      level = previousLevel === 0 ? 1 : Math.min(level, previousLevel + 1);
      if (kind === "part") {
        insidePart = true;
        firstChapterInPart = true;
      } else if (kind === "appendix" || kind === "backmatter") {
        insidePart = false;
        firstChapterInPart = false;
      }
      if (kind === "part" || kind === "chapter") {
        currentRole = "body";
      } else if (level === 1) {
        currentRole = roleFor(kind, currentRole);
      }
      const include = Boolean(
        matchedEntry ||
        (!localPart && numbered) ||
        frontmatter.test(heading.text) ||
        backmatter.test(heading.text),
      );
      const major =
        (!localPart && kind === "part") ||
        kind === "appendix" ||
        kind === "backmatter" ||
        kind === "frontmatter" ||
        kind === "chapter";
      const startsPage =
        index === 0 ||
        (major && !(kind === "chapter" && insidePart && firstChapterInPart));
      if (kind === "chapter" && insidePart) firstChapterInPart = false;
      previousLevel = level;
      return Object.freeze({
        anchor: heading.anchor,
        disposition: Object.freeze({
          display_level: level,
          display_title: null,
          include_in_toc: include,
          kind: "expected_body" as const,
          role: currentRole,
          starts_page: startsPage,
        }),
      });
    }),
  );
}

export function authorMineruReferenceV2(input: {
  readonly pack: MineruReferencePack;
  readonly transcript: CodexVisionTranscript;
}): MineruReferenceV2 {
  const transcript = parseCodexVisionTranscript(input.transcript);
  if (input.pack.fixture_id !== transcript.fixture_id) {
    throw new Error("VISION_REFERENCE_FIXTURE_MISMATCH");
  }
  const markdown = input.pack.markdown_documents[0];
  const original = input.pack.pdf_documents.find((pdf) =>
    /_origin\.pdf$/iu.test(pdf.relative_path),
  );
  if (!markdown || input.pack.markdown_documents.length !== 1 || !original) {
    throw new Error("VISION_REFERENCE_PRIMARY_INPUT_INVALID");
  }
  const allHeadings: HeadingText[] = markdown.headings.map((heading) => ({
    anchor: Object.freeze({
      root_index: heading.root_index,
      sha256: heading.sha256,
    }),
    depth: heading.depth,
    rootIndex: heading.root_index,
    text: normalize(heading.text),
    type: heading.type,
  }));
  const excludedRoots = new Set(
    transcript.regions.flatMap((region) =>
      Array.from(
        { length: region.end_root - region.start_root + 1 },
        (_, index) => region.start_root + index,
      ),
    ),
  );
  const bodyHeadings = allHeadings.filter(
    (heading) => !excludedRoots.has(heading.rootIndex),
  );
  const regions = transcript.regions.map((region) => {
    const start = markdown.root_blocks[region.start_root];
    const end = markdown.root_blocks[region.end_root];
    if (!start || !end)
      throw new Error("VISION_REFERENCE_ROOT_OUTSIDE_DOCUMENT");
    return Object.freeze({
      canonical: region.canonical,
      entries: matchEntries(region.entries, bodyHeadings),
      markdown_range: Object.freeze({
        end: Object.freeze({ root_index: end.root_index, sha256: end.sha256 }),
        start: Object.freeze({
          root_index: start.root_index,
          sha256: start.sha256,
        }),
      }),
      pdf_page_indices: region.pdf_page_indices,
      region_key: region.region_key,
    });
  });
  const value = {
    archive_sha256: input.pack.archive_sha256,
    expected_diagnostics: regions.flatMap((region) => {
      const hasMatchedEntry = region.entries.some(
        (entry) => entry.expected_match === "matched",
      );
      return region.entries
        .flatMap((entry) =>
          entry.expected_match === "matched"
            ? []
            : [
                {
                  code:
                    entry.expected_match === "ambiguous"
                      ? "PRINTED_TOC_AMBIGUOUS_MATCH"
                      : "PRINTED_TOC_UNMATCHED_ENTRY",
                  location: {
                    entry_key: entry.entry_key,
                    kind: "entry" as const,
                  },
                  phase: "matching" as const,
                  recovery: [
                    hasMatchedEntry
                      ? ("select_structure" as const)
                      : ("reload" as const),
                  ],
                  severity: "info" as const,
                },
              ],
        )
        .slice(0, 100);
    }),
    fixture_id: input.pack.fixture_id,
    main_markdown: {
      input_sha256: markdown.input_sha256,
      relative_path: markdown.relative_path,
    },
    original_pdf: {
      page_count: original.page_count,
      relative_path: original.relative_path,
      sha256: original.sha256,
    },
    printed_contents: {
      regions,
      state: regions.length > 0 ? ("present" as const) : ("absent" as const),
    },
    protected_ranges: [],
    raw_heading_accounting: headingAccounting({
      headings: allHeadings,
      regions,
    }),
    schema_version: 2 as const,
  };
  return parseMineruReferenceV2(value);
}

export async function readVisionFixtureDecision(
  path: string,
): Promise<VisionFixtureDecision> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VISION_REFERENCE_DECISION_INVALID");
  }
  return value as VisionFixtureDecision;
}

export function transcriptDigest(transcript: CodexVisionTranscript): string {
  return sha256(`${JSON.stringify(transcript)}\n`);
}

function parseDecisionSet(value: unknown): VisionDecisionSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VISION_REFERENCE_DECISION_INVALID");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (
    input.schema_version !== 1 ||
    !Array.isArray(input.fixtures) ||
    input.fixtures.length !== 15 ||
    Object.keys(input).sort().join(",") !== "fixtures,schema_version"
  ) {
    throw new Error("VISION_REFERENCE_DECISION_INVALID");
  }
  const fixtures = input.fixtures as readonly VisionFixtureDecision[];
  if (new Set(fixtures.map((fixture) => fixture.fixture_id)).size !== 15) {
    throw new Error("VISION_REFERENCE_DECISION_INVALID");
  }
  for (const fixture of fixtures) {
    if (
      !fixture ||
      typeof fixture.fixture_id !== "string" ||
      !fixture.printed_contents ||
      !["absent", "present"].includes(fixture.printed_contents.state)
    ) {
      throw new Error("VISION_REFERENCE_DECISION_INVALID");
    }
    if (fixture.printed_contents.state === "present") {
      const regions = fixture.printed_contents.regions;
      if (
        !Array.isArray(regions) ||
        regions.length < 1 ||
        regions.filter((region) => region.canonical).length !== 1
      ) {
        throw new Error("VISION_REFERENCE_DECISION_INVALID");
      }
      for (const region of regions) {
        if (
          !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(region.region_key) ||
          !Number.isSafeInteger(region.start_root) ||
          !Number.isSafeInteger(region.end_root) ||
          region.start_root < 0 ||
          region.end_root < region.start_root ||
          !Array.isArray(region.pdf_page_indices) ||
          region.pdf_page_indices.length < 1 ||
          region.pdf_page_indices.some(
            (page: number, index: number) =>
              !Number.isSafeInteger(page) ||
              page < 0 ||
              (index > 0 && page <= (region.pdf_page_indices[index - 1] ?? -1)),
          )
        ) {
          throw new Error("VISION_REFERENCE_DECISION_INVALID");
        }
      }
    }
  }
  return Object.freeze({
    fixtures: Object.freeze([...fixtures]),
    schema_version: 1,
  });
}

export async function createRealMineruTranscriptTemplates(input: {
  readonly decisionsPath: string;
  readonly realDirectory: string;
  readonly transcriptDirectory: string;
}): Promise<
  readonly {
    readonly entries: number;
    readonly fixture_id: string;
    readonly headings: number;
    readonly regions: number;
  }[]
> {
  const root = resolve(input.realDirectory);
  const decisions = parseDecisionSet(
    JSON.parse(await readFile(resolve(input.decisionsPath), "utf8")) as unknown,
  );
  const manifest = parseRealFixtureManifest(
    JSON.parse(
      await readFile(join(root, "real-fixtures.json"), "utf8"),
    ) as unknown,
  );
  await verifyRealMineruFixtures(root);
  const registered = new Set(manifest.fixtures.map((fixture) => fixture.id));
  if (
    decisions.fixtures.some((decision) => !registered.has(decision.fixture_id))
  ) {
    throw new Error("VISION_REFERENCE_FIXTURE_NOT_REGISTERED");
  }
  const transcriptDirectory = resolve(input.transcriptDirectory);
  await mkdir(transcriptDirectory, { mode: 0o700, recursive: true });
  const summaries = [];
  for (const decision of decisions.fixtures) {
    const fixture = manifest.fixtures.find(
      (item) => item.id === decision.fixture_id,
    );
    if (!fixture) throw new Error("VISION_REFERENCE_FIXTURE_NOT_REGISTERED");
    const pack = JSON.parse(
      await readFile(
        join(root, "reference-packs", decision.fixture_id, "observations.json"),
        "utf8",
      ),
    ) as MineruReferencePack;
    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "mirawind-vision-reference-"),
    );
    try {
      const extractedRoot = join(temporaryRoot, "extracted");
      await extractZipFile({
        archivePath: join(root, fixture.file_name),
        destination: extractedRoot,
      });
      const markdown = pack.markdown_documents[0];
      if (!markdown || pack.markdown_documents.length !== 1) {
        throw new Error("VISION_REFERENCE_PRIMARY_INPUT_INVALID");
      }
      const markdownPath = await resolveContainedPath(
        extractedRoot,
        markdown.relative_path,
      );
      const source = await readFile(markdownPath, "utf8");
      if (sha256(source) !== markdown.input_sha256) {
        throw new Error("VISION_REFERENCE_MARKDOWN_HASH_MISMATCH");
      }
      const transcript = createVisionTranscriptTemplate({
        decision,
        document: parseMarkdownDocument(source),
        pack,
      });
      const transcriptPath = join(
        transcriptDirectory,
        `${decision.fixture_id}.template.json`,
      );
      await writeFile(
        transcriptPath,
        `${JSON.stringify(transcript, null, 2)}\n`,
        {
          mode: 0o600,
        },
      );
      summaries.push(
        Object.freeze({
          entries: transcript.regions.reduce(
            (total, region) => total + region.entries.length,
            0,
          ),
          fixture_id: decision.fixture_id,
          headings: markdown.headings.length,
          regions: transcript.regions.length,
        }),
      );
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  }
  return Object.freeze(summaries);
}

export async function reauthorRealMineruReferences(input: {
  readonly fixtureId?: string;
  readonly realDirectory: string;
  readonly referenceDirectory: string;
  readonly transcriptDirectory: string;
}): Promise<void> {
  const root = resolve(input.realDirectory);
  const manifest = parseRealFixtureManifest(
    JSON.parse(
      await readFile(join(root, "real-fixtures.json"), "utf8"),
    ) as unknown,
  );
  if (manifest.fixtures.length !== 15) {
    throw new Error("VISION_REFERENCE_SET_MUST_CONTAIN_FIFTEEN_FIXTURES");
  }
  const referenceDirectory = resolve(input.referenceDirectory);
  const transcriptDirectory = resolve(input.transcriptDirectory);
  await mkdir(referenceDirectory, { mode: 0o700, recursive: true });
  const fixtures = input.fixtureId
    ? manifest.fixtures.filter((fixture) => fixture.id === input.fixtureId)
    : manifest.fixtures;
  if (fixtures.length < 1) {
    throw new Error("VISION_REFERENCE_FIXTURE_NOT_REGISTERED");
  }
  for (const fixture of fixtures) {
    const pack = JSON.parse(
      await readFile(
        join(root, "reference-packs", fixture.id, "observations.json"),
        "utf8",
      ),
    ) as MineruReferencePack;
    const transcript = parseCodexVisionTranscript(
      JSON.parse(
        await readFile(join(transcriptDirectory, `${fixture.id}.json`), "utf8"),
      ) as unknown,
    );
    const reference = authorMineruReferenceV2({ pack, transcript });
    await writeFile(
      join(referenceDirectory, `${fixture.id}.json`),
      `${JSON.stringify(reference, null, 2)}\n`,
      { mode: 0o600 },
    );
  }
}

function argumentsMap(arguments_: readonly string[]): Map<string, string> {
  const values = new Map<string, string>();
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    const value = normalized[index + 1];
    if (
      !name ||
      !value ||
      ![
        "--decisions",
        "--fixture",
        "--real-dir",
        "--reference-dir",
        "--reuse-transcripts",
        "--transcript-dir",
      ].includes(name) ||
      values.has(name)
    ) {
      throw new Error("Arguments must be unique --name value pairs");
    }
    values.set(name, value);
  }
  return values;
}

async function main(): Promise<void> {
  const values = argumentsMap(process.argv.slice(2));
  const decisionsPath = values.get("--decisions");
  const realDirectory = values.get("--real-dir");
  const referenceDirectory = values.get("--reference-dir");
  const transcriptDirectory = values.get("--transcript-dir");
  if (!realDirectory || !referenceDirectory || !transcriptDirectory) {
    throw new Error("Required: --real-dir --transcript-dir --reference-dir");
  }
  if (values.get("--reuse-transcripts") === "true") {
    const fixtureId = values.get("--fixture");
    await reauthorRealMineruReferences({
      ...(fixtureId ? { fixtureId } : {}),
      realDirectory,
      referenceDirectory,
      transcriptDirectory,
    });
    process.stdout.write(
      `${JSON.stringify({ ok: true, reused_transcripts: true })}\n`,
    );
    return;
  }
  if (!decisionsPath) throw new Error("Required: --decisions");
  const summaries = await createRealMineruTranscriptTemplates({
    decisionsPath,
    realDirectory,
    transcriptDirectory,
  });
  process.stdout.write(
    `${JSON.stringify({ fixtures: summaries, ok: true, templates_only: true })}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
