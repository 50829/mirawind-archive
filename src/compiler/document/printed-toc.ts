import { createHash } from "node:crypto";

import { createOpaqueId } from "../../domain/ids.js";
import { utf8ByteOffset } from "./source-regions.js";
import type {
  ConfirmedSourceRegion,
  NormalizedDocument,
  TransientDocumentNode,
} from "./types.js";

export interface PrintedContentsDiagnostic {
  readonly code:
    | "PRINTED_TOC_AMBIGUOUS_MATCH"
    | "PRINTED_TOC_INSUFFICIENT_ENTRIES"
    | "PRINTED_TOC_LEVEL_GAP"
    | "PRINTED_TOC_LOW_COVERAGE"
    | "PRINTED_TOC_RICH_CONTENT"
    | "PRINTED_TOC_UNMATCHED_ENTRY";
  readonly path: string;
}

export interface PrintedContentsCandidate {
  readonly confidence: "high" | "low" | "medium";
  readonly diagnostics: readonly PrintedContentsDiagnostic[];
  readonly endByte: number;
  readonly entryCount: number;
  readonly matchedHeadingCount: number;
  readonly proposedRegion?: ConfirmedSourceRegion;
  readonly startByte: number;
}

export interface PrintedContentsDetection {
  readonly candidates: readonly PrintedContentsCandidate[];
}

interface ExtractedEntry {
  readonly bodyHeadingBlockId?: string;
  readonly normalizedTitle: string;
  readonly range: {
    readonly end_byte: number;
    readonly sha256: string;
    readonly start_byte: number;
  };
  readonly referenceLevel: number;
}

const contentsTitle = /^(?:目\s*录|contents|table\s+of\s+contents)$/iu;
const trailingPage =
  /(?:\.{2,}|…{2,}|·{2,}|_{2,}|\s{2,})\s*(?:\d+|[ivxlcdm]+)\s*$/iu;
const richTypes = new Set([
  "definition",
  "footnoteDefinition",
  "html",
  "image",
  "imageReference",
  "link",
  "linkReference",
  "math",
  "table",
]);

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizedTitle(value: string): string {
  return value
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/u, "")
    .replace(trailingPage, "")
    .replace(
      /^(?:第\s*[0-9一二三四五六七八九十百]+\s*章|(?:chapter|chap\.?)\s*[0-9ivxlcdm]+|附录\s*[A-Za-z0-9一二三四五六七八九十]*|\d+(?:\.\d+){0,3})[\s、:：.-]*/iu,
      "",
    )
    .replace(/[，,。.;；:：!?！？]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("und");
}

export function inferPrintedReferenceLevel(value: string): number | undefined {
  const plain = value.replace(/^[ \t]{0,3}#{1,6}[ \t]+/u, "").trim();
  if (
    /^(?:第\s*[0-9一二三四五六七八九十百]+\s*章|(?:chapter|chap\.?)\s*[0-9ivxlcdm]+|附录(?:\s|[A-Za-z0-9一二三四五六七八九十]|$))/iu.test(
      plain,
    )
  ) {
    return 1;
  }
  const numeric = /^(\d+(?:\.\d+){0,3})(?:\s|、|:|：|\.|-)/u.exec(plain)?.[1];
  if (numeric) return Math.min(4, numeric.split(".").length);
  return undefined;
}

function containsRichContent(node: TransientDocumentNode): boolean {
  if (richTypes.has(node.type)) return true;
  return (node.children ?? []).some(containsRichContent);
}

function lineEntries(input: {
  readonly block: TransientDocumentNode;
  readonly source: string;
  readonly sourceBytes: Uint8Array;
}): readonly ExtractedEntry[] {
  if (!input.block.position) return [];
  const blockSource = input.source.slice(
    input.block.position.start.offset,
    input.block.position.end.offset,
  );
  const entries: ExtractedEntry[] = [];
  let lineOffset = 0;
  for (const line of blockSource.split(/\n/u)) {
    const hasPrintedPage = trailingPage.test(line);
    const level = hasPrintedPage
      ? (inferPrintedReferenceLevel(line) ?? 1)
      : undefined;
    trailingPage.lastIndex = 0;
    if (level) {
      const title = normalizedTitle(line);
      if (title) {
        const startOffset = input.block.position.start.offset + lineOffset;
        const endOffset = startOffset + line.length;
        const startByte = utf8ByteOffset(input.source, startOffset);
        const endByte = utf8ByteOffset(input.source, endOffset);
        entries.push(
          Object.freeze({
            normalizedTitle: title,
            range: Object.freeze({
              end_byte: endByte,
              sha256: hash(input.sourceBytes.subarray(startByte, endByte)),
              start_byte: startByte,
            }),
            referenceLevel: level,
          }),
        );
      }
    }
    lineOffset += line.length + 1;
  }
  return Object.freeze(entries);
}

function rootTitle(node: TransientDocumentNode): string {
  const values: string[] = [];
  const visit = (current: TransientDocumentNode) => {
    if (current.type === "text" && current.value) values.push(current.value);
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return values.join("").trim();
}

function diagnostic(
  code: PrintedContentsDiagnostic["code"],
  path: string,
): PrintedContentsDiagnostic {
  return Object.freeze({ code, path: path.slice(0, 500) });
}

export function detectPrintedContents(input: {
  readonly document: NormalizedDocument;
  readonly idFactory?: () => string;
  readonly sourcePath: string;
  readonly sourceSha256: string;
}): PrintedContentsDetection {
  const sourceBytes = Buffer.from(input.document.source, "utf8");
  if (hash(sourceBytes) !== input.sourceSha256) {
    throw new Error("PRINTED_TOC_SOURCE_HASH_MISMATCH");
  }
  const roots = input.document.root.children ?? [];
  const candidates: PrintedContentsCandidate[] = [];
  for (let labelIndex = 0; labelIndex < roots.length; labelIndex += 1) {
    const label = roots[labelIndex];
    if (
      !label?.position ||
      label.type !== "heading" ||
      !contentsTitle.test(rootTitle(label).normalize("NFC"))
    ) {
      continue;
    }
    const entries: ExtractedEntry[] = [];
    let candidateEndIndex = labelIndex;
    let bodyStartIndex = roots.length;
    let richContent = false;
    for (let index = labelIndex + 1; index < roots.length; index += 1) {
      const block = roots[index];
      if (!block?.position) continue;
      const extracted = lineEntries({
        block,
        source: input.document.source,
        sourceBytes,
      });
      const possibleBodyTitle =
        block.type === "heading" ? normalizedTitle(rootTitle(block)) : "";
      if (
        extracted.length === 0 &&
        possibleBodyTitle &&
        entries.some((entry) => entry.normalizedTitle === possibleBodyTitle)
      ) {
        bodyStartIndex = index;
        break;
      }
      if (containsRichContent(block)) richContent = true;
      if (extracted.length > 0) entries.push(...extracted);
      candidateEndIndex = index;
      if (entries.length > 20_000) break;
    }

    const laterHeadings = input.document.headings.filter(
      (heading) =>
        (heading.position?.start.offset ?? Number.NEGATIVE_INFINITY) >=
        (roots[bodyStartIndex]?.position?.start.offset ??
          Number.POSITIVE_INFINITY),
    );
    const headingMatches = new Map<string, typeof laterHeadings>();
    for (const heading of laterHeadings) {
      const key = normalizedTitle(heading.sourceTitle);
      const values = headingMatches.get(key) ?? [];
      headingMatches.set(key, [...values, heading]);
    }
    const diagnostics: PrintedContentsDiagnostic[] = [];
    const matchedEntries: ExtractedEntry[] = [];
    let previousHeadingOffset = -1;
    for (const [entryIndex, entry] of entries.entries()) {
      const matches = headingMatches.get(entry.normalizedTitle) ?? [];
      if (matches.length > 1) {
        diagnostics.push(
          diagnostic(
            "PRINTED_TOC_AMBIGUOUS_MATCH",
            `candidates/${candidates.length}/entries/${entryIndex}`,
          ),
        );
        matchedEntries.push(entry);
        continue;
      }
      const match = matches[0];
      if (
        !match?.position ||
        match.position.start.offset <= previousHeadingOffset
      ) {
        diagnostics.push(
          diagnostic(
            "PRINTED_TOC_UNMATCHED_ENTRY",
            `candidates/${candidates.length}/entries/${entryIndex}`,
          ),
        );
        matchedEntries.push(entry);
        continue;
      }
      previousHeadingOffset = match.position.start.offset;
      matchedEntries.push(
        Object.freeze({
          ...entry,
          bodyHeadingBlockId: match.blockId,
        }),
      );
    }
    if (entries.length < 3) {
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_INSUFFICIENT_ENTRIES",
          `candidates/${candidates.length}`,
        ),
      );
    }
    let previousLevel = 0;
    if (
      entries.some((entry) => {
        const skipped =
          previousLevel === 0
            ? entry.referenceLevel !== 1
            : entry.referenceLevel > previousLevel + 1;
        previousLevel = entry.referenceLevel;
        return skipped;
      })
    ) {
      diagnostics.push(
        diagnostic("PRINTED_TOC_LEVEL_GAP", `candidates/${candidates.length}`),
      );
    }
    if (richContent) {
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_RICH_CONTENT",
          `candidates/${candidates.length}`,
        ),
      );
    }
    const matchedCount = matchedEntries.filter(
      (entry) => entry.bodyHeadingBlockId,
    ).length;
    const coverage = entries.length === 0 ? 0 : matchedCount / entries.length;
    if (coverage < 0.8) {
      diagnostics.push(
        diagnostic(
          "PRINTED_TOC_LOW_COVERAGE",
          `candidates/${candidates.length}`,
        ),
      );
    }
    const high =
      entries.length >= 3 &&
      matchedCount >= 3 &&
      coverage >= 0.8 &&
      !richContent &&
      !diagnostics.some((item) =>
        ["PRINTED_TOC_AMBIGUOUS_MATCH", "PRINTED_TOC_LEVEL_GAP"].includes(
          item.code,
        ),
      );
    const startByte = utf8ByteOffset(
      input.document.source,
      label.position.start.offset,
    );
    const candidateEnd = roots[candidateEndIndex] ?? label;
    const endByte = utf8ByteOffset(
      input.document.source,
      candidateEnd.position?.end.offset ?? label.position.end.offset,
    );
    const proposedRegion = high
      ? Object.freeze({
          applied: true,
          disposition: "reference_only" as const,
          entries: Object.freeze(
            matchedEntries.map((entry) =>
              Object.freeze({
                ...(entry.bodyHeadingBlockId
                  ? { body_heading_block_id: entry.bodyHeadingBlockId }
                  : {}),
                range: entry.range,
                reference_level: entry.referenceLevel,
              }),
            ),
          ),
          kind: "printed_toc" as const,
          range: Object.freeze({
            end_byte: endByte,
            sha256: hash(sourceBytes.subarray(startByte, endByte)),
            start_byte: startByte,
          }),
          region_id: input.idFactory?.() ?? createOpaqueId("region"),
          source_path: input.sourcePath,
          source_sha256: input.sourceSha256,
        })
      : undefined;
    candidates.push(
      Object.freeze({
        confidence: high ? "high" : entries.length >= 3 ? "medium" : "low",
        diagnostics: Object.freeze(diagnostics.slice(0, 100)),
        endByte,
        entryCount: entries.length,
        matchedHeadingCount: matchedCount,
        ...(proposedRegion ? { proposedRegion } : {}),
        startByte,
      }),
    );
  }
  return Object.freeze({ candidates: Object.freeze(candidates) });
}
