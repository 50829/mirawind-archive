import { createHash } from "node:crypto";

import { parseMarkdownDocument } from "@/compiler/document/parser";
import type {
  TransientDocumentNode,
  TypographyProfile,
  TypographyProvenance,
} from "@/compiler/document/types";

export type { TypographyProfile, TypographyProvenance };

export interface TypographyPreprocessResult {
  readonly markdown: string;
  readonly provenance: TypographyProvenance;
  readonly riskSummaries: readonly TypographyRiskSummary[];
  readonly riskSummariesTruncated: boolean;
}

export interface TypographyRiskSummary {
  readonly code:
    | "TYPOGRAPHY_MIXED_REWRITE"
    | "TYPOGRAPHY_PUNCTUATION_REWRITE"
    | "TYPOGRAPHY_SPACING_REWRITE";
  readonly end_byte: number;
  readonly punctuation_converted: number;
  readonly spaces_normalized: number;
  readonly start_byte: number;
}

export interface TypographyProtectedRange {
  readonly end_byte: number;
  readonly kind:
    | "code"
    | "formula"
    | "html"
    | "link_destination"
    | "path"
    | "command"
    | "technical_token";
  readonly start_byte: number;
}

interface TextLeaf {
  readonly end: number;
  readonly path: readonly TransientDocumentNode[];
  readonly start: number;
  transformed: string;
}

interface BarrierLeaf {
  readonly barrier: true;
}

interface ProtectedTextLeaf {
  readonly end: number;
  readonly path: readonly TransientDocumentNode[];
  readonly protected: true;
  readonly start: number;
  readonly visible: string;
}

type InlineLeaf = TextLeaf | ProtectedTextLeaf | BarrierLeaf;

interface ProtectedRange {
  readonly end: number;
  readonly start: number;
}

interface DetectedProtectedRange {
  readonly end: number;
  readonly kind: TypographyProtectedRange["kind"];
  readonly start: number;
}

const maximumCounter = 2_147_483_647;
const maximumProtectedRanges = 100_000;
const maximumRiskSummaries = 100;
const horizontalWhitespace =
  "[\\t\\f\\v \\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000]";
const hanPattern = /\p{Script=Han}/u;
const latinOrDigitPattern = /[\p{Script=Latin}0-9]/u;
const chinesePunctuationPattern = /[，。；：？！、（）《》“”‘’「」『』【】]/u;
const opaqueTypes = new Set([
  "code",
  "html",
  "image",
  "inlineCode",
  "inlineMath",
  "math",
]);

const technicalTokenPattern =
  /(?:10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)|(?:ISBN(?:-1[03])?:?\s*(?:97[89][-\s]?)?\d(?:[-\s]?\d){8,12}[\dX])|(?:(?:https?|ftp):\/\/|www\.)[^\s<>\p{Script=Han}]+|(?:[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})|(?:--?[A-Za-z][A-Za-z0-9_-]*(?:=(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s<>`]+))?)|(?:(?:[A-Za-z]:\\|\.{0,2}\/|\/)[^\s<>"'`]*?\.[A-Za-z0-9]{1,12}(?=$|\s|\p{Script=Han}))|(?:(?:[A-Za-z]:\\|\.{0,2}\/|\/)[^\s<>"'`，。；：？！]+)|(?:\bv?\d+(?:\.\d+){1,}\b)|(?:\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b)|(?:\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b)|(?:\b\d+\.\d+\b)|(?:\b[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,12}\b)/gu;

function technicalKind(value: string): "command" | "path" | "technical_token" {
  if (/^--?[A-Za-z]/u.test(value)) return "command";
  if (/^(?:[A-Za-z]:\\|\.{0,2}\/|\/)/u.test(value)) return "path";
  return "technical_token";
}

function nodeRange(
  node: TransientDocumentNode,
): { readonly end: number; readonly start: number } | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    Number(end) <= Number(start)
  ) {
    return;
  }
  return Object.freeze({ end: Number(end), start: Number(start) });
}

function linkDestinationRange(
  node: TransientDocumentNode,
  source: string,
): DetectedProtectedRange | undefined {
  const range = nodeRange(node);
  if (!range || !node.url) return;
  const raw = source.slice(range.start, range.end);
  const relativeStart = raw.indexOf(node.url);
  if (relativeStart < 0) return;
  return Object.freeze({
    end: range.start + relativeStart + node.url.length,
    kind: "link_destination" as const,
    start: range.start + relativeStart,
  });
}

function byteOffsets(
  source: string,
  values: readonly number[],
): ReadonlyMap<number, number> {
  const offsets = [...new Set(values)].sort((left, right) => left - right);
  const result = new Map<number, number>();
  let byteCursor = 0;
  let characterCursor = 0;
  for (const offset of offsets) {
    byteCursor += Buffer.byteLength(
      source.slice(characterCursor, offset),
      "utf8",
    );
    characterCursor = offset;
    result.set(offset, byteCursor);
  }
  return result;
}

export function findTypographyProtectedRanges(
  source: string,
): readonly TypographyProtectedRange[] {
  const document = parseMarkdownDocument(source);
  const detected: DetectedProtectedRange[] = [];
  const addNode = (
    node: TransientDocumentNode,
    kind: TypographyProtectedRange["kind"],
  ): void => {
    const range = nodeRange(node);
    if (range) detected.push(Object.freeze({ ...range, kind }));
  };
  const visit = (node: TransientDocumentNode): void => {
    if (node.type === "code" || node.type === "inlineCode") {
      addNode(node, "code");
      return;
    }
    if (node.type === "math" || node.type === "inlineMath") {
      addNode(node, "formula");
      return;
    }
    if (node.type === "html") {
      addNode(node, "html");
      return;
    }
    if (node.type === "image") {
      const destination = linkDestinationRange(node, source);
      if (destination) detected.push(destination);
      return;
    }
    if (node.type === "link") {
      const destination = linkDestinationRange(node, source);
      if (destination) detected.push(destination);
      const range = nodeRange(node);
      const raw = range ? source.slice(range.start, range.end) : "";
      if (!raw.includes("[")) return;
    }
    if (
      node.type === "text" &&
      node.position &&
      typeof node.value === "string"
    ) {
      const raw = source.slice(
        node.position.start.offset,
        node.position.end.offset,
      );
      if (raw === node.value) {
        technicalTokenPattern.lastIndex = 0;
        for (const match of raw.matchAll(technicalTokenPattern)) {
          const start = node.position.start.offset + (match.index ?? 0);
          detected.push(
            Object.freeze({
              end: start + match[0].length,
              kind: technicalKind(match[0]),
              start,
            }),
          );
        }
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document.root);
  detected.sort(
    (left, right) =>
      left.start - right.start ||
      right.end - left.end ||
      left.kind.localeCompare(right.kind, "en"),
  );
  const nonOverlapping: DetectedProtectedRange[] = [];
  for (const range of detected) {
    const previous = nonOverlapping.at(-1);
    if (previous && range.start < previous.end) continue;
    nonOverlapping.push(range);
    if (nonOverlapping.length > maximumProtectedRanges) {
      throw new Error("TYPOGRAPHY_PROTECTED_RANGE_LIMIT_EXCEEDED");
    }
  }
  const offsets = byteOffsets(
    source,
    nonOverlapping.flatMap((range) => [range.start, range.end]),
  );
  return Object.freeze(
    nonOverlapping.map((range) =>
      Object.freeze({
        end_byte: offsets.get(range.end) ?? 0,
        kind: range.kind,
        start_byte: offsets.get(range.start) ?? 0,
      }),
    ),
  );
}

function clampCounter(value: number): number {
  return Math.min(value, maximumCounter);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function decode(input: string | Uint8Array): string {
  if (typeof input === "string") return input;
  return new TextDecoder("utf-8", { fatal: true }).decode(input);
}

function protectedRanges(value: string): readonly ProtectedRange[] {
  technicalTokenPattern.lastIndex = 0;
  return Object.freeze(
    [...value.matchAll(technicalTokenPattern)].map((match) =>
      Object.freeze({
        end: (match.index ?? 0) + match[0].length,
        start: match.index ?? 0,
      }),
    ),
  );
}

function isProtected(
  ranges: readonly ProtectedRange[],
  index: number,
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (!range) return false;
    if (index < range.start) high = middle - 1;
    else if (index >= range.end) low = middle + 1;
    else return true;
  }
  return false;
}

function transformUnprotected(
  value: string,
  transform: (segment: string) => string,
): string {
  const ranges = protectedRanges(value);
  if (ranges.length === 0) return transform(value);
  let cursor = 0;
  let output = "";
  for (const range of ranges) {
    output += transform(value.slice(cursor, range.start));
    output += value.slice(range.start, range.end);
    cursor = range.end;
  }
  return output + transform(value.slice(cursor));
}

function previousVisibleCharacter(value: string, index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const character = value[cursor] ?? "";
    if (!new RegExp(horizontalWhitespace, "u").test(character)) {
      return character;
    }
  }
  return "";
}

function nextVisibleCharacter(value: string, index: number): string {
  for (let cursor = index + 1; cursor < value.length; cursor += 1) {
    const character = value[cursor] ?? "";
    if (!new RegExp(horizontalWhitespace, "u").test(character)) {
      return character;
    }
  }
  return "";
}

function isChineseContextCharacter(value: string): boolean {
  return hanPattern.test(value) || chinesePunctuationPattern.test(value);
}

function normalizePunctuation(value: string): {
  readonly converted: number;
  readonly value: string;
} {
  let output = value;
  let converted = 0;
  let ranges = protectedRanges(output);

  output = output.replace(/(?<!\.)\.{3}(?!\.)/gu, (match, offset: number) => {
    if (
      [0, 1, 2].some((delta) => isProtected(ranges, offset + delta)) ||
      (!isChineseContextCharacter(previousVisibleCharacter(output, offset)) &&
        !isChineseContextCharacter(nextVisibleCharacter(output, offset + 2)))
    ) {
      return match;
    }
    converted += 1;
    return "……";
  });
  ranges = protectedRanges(output);

  const characters = [...output];
  const pairStack: number[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] === "(" && !isProtected(ranges, index)) {
      pairStack.push(index);
    } else if (
      characters[index] === ")" &&
      !isProtected(ranges, index) &&
      pairStack.length > 0
    ) {
      const start = pairStack.pop();
      if (start === undefined) continue;
      const inside = characters.slice(start + 1, index).join("");
      const outsideLeft = previousVisibleCharacter(output, start);
      const outsideRight = nextVisibleCharacter(output, index);
      if (
        hanPattern.test(inside) ||
        hanPattern.test(outsideLeft) ||
        hanPattern.test(outsideRight)
      ) {
        characters[start] = "（";
        characters[index] = "）";
        converted += 2;
      }
    }
  }

  let openQuote: number | undefined;
  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] !== '"' || isProtected(ranges, index)) continue;
    if (openQuote === undefined) {
      openQuote = index;
      continue;
    }
    const inside = characters.slice(openQuote + 1, index).join("");
    const outsideLeft = previousVisibleCharacter(output, openQuote);
    const outsideRight = nextVisibleCharacter(output, index);
    if (
      hanPattern.test(inside) ||
      hanPattern.test(outsideLeft) ||
      hanPattern.test(outsideRight)
    ) {
      characters[openQuote] = "“";
      characters[index] = "”";
      converted += 2;
    }
    openQuote = undefined;
  }

  const punctuation = new Map([
    [",", "，"],
    [";", "；"],
    [":", "："],
    ["?", "？"],
    ["!", "！"],
  ]);
  for (let index = 0; index < characters.length; index += 1) {
    const replacement = punctuation.get(characters[index] ?? "");
    if (!replacement || isProtected(ranges, index)) continue;
    if (
      isChineseContextCharacter(previousVisibleCharacter(output, index)) ||
      isChineseContextCharacter(nextVisibleCharacter(output, index))
    ) {
      characters[index] = replacement;
      converted += 1;
    }
  }
  output = characters.join("");
  ranges = protectedRanges(output);

  const withPeriods = [...output];
  for (let index = 0; index < withPeriods.length; index += 1) {
    if (withPeriods[index] !== "." || isProtected(ranges, index)) continue;
    const left = previousVisibleCharacter(output, index);
    const right = nextVisibleCharacter(output, index);
    if (
      (hanPattern.test(left) || /[”’）》」』】]/u.test(left)) &&
      (!right ||
        right === "\n" ||
        hanPattern.test(right) ||
        /[”’）》」』】]/u.test(right))
    ) {
      withPeriods[index] = "。";
      converted += 1;
    }
  }

  return Object.freeze({
    converted,
    value: transformUnprotected(withPeriods.join(""), (segment) =>
      segment
        .replace(
          new RegExp(
            `${horizontalWhitespace}+(?=[，。；：？！）》」』】])`,
            "gu",
          ),
          "",
        )
        .replace(
          new RegExp(`(?<=[（《“‘「『【])${horizontalWhitespace}+`, "gu"),
          "",
        )
        .replace(
          new RegExp(
            `(?<=[，。；：？！）》」』】])${horizontalWhitespace}+(?=[\\p{Script=Han}（《“‘「『【])`,
            "gu",
          ),
          "",
        )
        .replace(
          new RegExp(
            `(?<=[\\p{Script=Han}）》」』】”’])${horizontalWhitespace}+(?=[（《“‘「『【])`,
            "gu",
          ),
          "",
        ),
    ),
  });
}

function normalizeUnprotectedSpacing(value: string): {
  readonly normalized: number;
  readonly value: string;
} {
  let normalized = 0;
  const ranges = protectedRanges(value);
  const forward = new RegExp(
    `(\\p{Script=Han})(${horizontalWhitespace}*)([\\p{Script=Latin}0-9])`,
    "gu",
  );
  const backward = new RegExp(
    `([\\p{Script=Latin}0-9])(${horizontalWhitespace}*)(\\p{Script=Han})`,
    "gu",
  );
  const normalizeSegment = (segment: string): string => {
    let output = segment.replace(
      forward,
      (_match, left: string, spaces: string, right: string) => {
        if (spaces !== " ") normalized += 1;
        return `${left} ${right}`;
      },
    );
    output = output.replace(
      backward,
      (_match, left: string, spaces: string, right: string) => {
        if (spaces !== " ") normalized += 1;
        return `${left} ${right}`;
      },
    );
    return output;
  };
  let cursor = 0;
  let output = "";
  for (const [rangeIndex, range] of ranges.entries()) {
    let before = normalizeSegment(value.slice(cursor, range.start));
    const token = value.slice(range.start, range.end);
    const left = boundaryCharacters(before).last;
    const tokenFirst = boundaryCharacters(token).first;
    if (
      before &&
      needsMixedSpace(left, tokenFirst) &&
      !new RegExp(`${horizontalWhitespace}$`, "u").test(before)
    ) {
      before += " ";
      normalized += 1;
    }
    output += before + token;
    cursor = range.end;
    const next = value.slice(cursor, ranges[rangeIndex + 1]?.start);
    const tokenLast = boundaryCharacters(token).last;
    const nextFirst = boundaryCharacters(next).first;
    if (
      next &&
      needsMixedSpace(tokenLast, nextFirst) &&
      !new RegExp(`^${horizontalWhitespace}`, "u").test(next)
    ) {
      output += " ";
      normalized += 1;
    }
  }
  output += normalizeSegment(value.slice(cursor));
  return Object.freeze({ normalized, value: output });
}

function normalizeText(value: string): {
  readonly protectedTokens: number;
  readonly punctuationConverted: number;
  readonly spacesNormalized: number;
  readonly value: string;
} {
  const punctuation = normalizePunctuation(value);
  const ranges = protectedRanges(punctuation.value);
  const spacing = normalizeUnprotectedSpacing(punctuation.value);
  return Object.freeze({
    protectedTokens: ranges.length,
    punctuationConverted: punctuation.converted,
    spacesNormalized: spacing.normalized,
    value: spacing.value,
  });
}

function commonPathLength(
  left: readonly TransientDocumentNode[],
  right: readonly TransientDocumentNode[],
): number {
  let index = 0;
  while (left[index] && left[index] === right[index]) index += 1;
  return index;
}

function isTextLeaf(value: InlineLeaf): value is TextLeaf {
  return !("barrier" in value) && !("protected" in value);
}

function isProtectedTextLeaf(value: InlineLeaf): value is ProtectedTextLeaf {
  return "protected" in value;
}

function isSpacingLeaf(
  value: InlineLeaf,
): value is TextLeaf | ProtectedTextLeaf {
  return isTextLeaf(value) || isProtectedTextLeaf(value);
}

function collectInlineLeaves(
  node: TransientDocumentNode,
  source: string,
  path: readonly TransientDocumentNode[],
  output: InlineLeaf[],
): number {
  if (opaqueTypes.has(node.type)) {
    output.push({ barrier: true });
    return 1;
  }
  if (
    node.type === "link" &&
    node.position &&
    !source
      .slice(node.position.start.offset, node.position.end.offset)
      .includes("[")
  ) {
    const visible = (node.children ?? [])
      .filter((child) => child.type === "text")
      .map((child) => child.value ?? "")
      .join("");
    output.push({
      end: node.position.end.offset,
      path: [...path, node],
      protected: true,
      start: node.position.start.offset,
      visible,
    });
    return 1;
  }
  if (node.type === "text" && node.position && typeof node.value === "string") {
    const raw = source.slice(
      node.position.start.offset,
      node.position.end.offset,
    );
    if (raw !== node.value) {
      output.push({ barrier: true });
      return 1;
    }
    output.push({
      end: node.position.end.offset,
      path,
      start: node.position.start.offset,
      transformed: raw,
    });
    return 0;
  }
  let protectedNodes = 0;
  const childPath = [...path, node];
  for (const child of node.children ?? []) {
    protectedNodes += collectInlineLeaves(child, source, childPath, output);
  }
  return protectedNodes;
}

function boundaryCharacters(value: string): {
  readonly first: string;
  readonly last: string;
} {
  const withoutLeading = value.replace(
    new RegExp(`^${horizontalWhitespace}*`, "u"),
    "",
  );
  const withoutTrailing = value.replace(
    new RegExp(`${horizontalWhitespace}*$`, "u"),
    "",
  );
  return {
    first: [...withoutLeading][0] ?? "",
    last: [...withoutTrailing].at(-1) ?? "",
  };
}

function needsMixedSpace(left: string, right: string): boolean {
  return (
    (hanPattern.test(left) && latinOrDigitPattern.test(right)) ||
    (latinOrDigitPattern.test(left) && hanPattern.test(right))
  );
}

function preprocessBody(source: string): {
  readonly markdown: string;
  readonly protectedNodes: number;
  readonly punctuationConverted: number;
  readonly riskSummaries: readonly TypographyRiskSummary[];
  readonly riskSummariesTruncated: boolean;
  readonly spacesNormalized: number;
} {
  const document = parseMarkdownDocument(source);
  const leaves: InlineLeaf[] = [];
  let protectedNodes = 0;
  for (const block of document.root.children ?? []) {
    const blockLeaves: InlineLeaf[] = [];
    protectedNodes += collectInlineLeaves(block, source, [], blockLeaves);
    leaves.push(...blockLeaves, { barrier: true });
  }

  let spacesNormalized = 0;
  let punctuationConverted = 0;
  const riskSummaries: TypographyRiskSummary[] = [];
  let riskSummaryCount = 0;
  const addRiskSummary = (input: {
    readonly end: number;
    readonly punctuationConverted: number;
    readonly spacesNormalized: number;
    readonly start: number;
  }) => {
    riskSummaryCount += 1;
    if (riskSummaries.length >= maximumRiskSummaries) return;
    const code =
      input.punctuationConverted > 0 && input.spacesNormalized > 0
        ? "TYPOGRAPHY_MIXED_REWRITE"
        : input.punctuationConverted > 0
          ? "TYPOGRAPHY_PUNCTUATION_REWRITE"
          : "TYPOGRAPHY_SPACING_REWRITE";
    riskSummaries.push(
      Object.freeze({
        code,
        end_byte: Buffer.byteLength(source.slice(0, input.end), "utf8"),
        punctuation_converted: clampCounter(input.punctuationConverted),
        spaces_normalized: clampCounter(input.spacesNormalized),
        start_byte: Buffer.byteLength(source.slice(0, input.start), "utf8"),
      }),
    );
  };
  for (const leaf of leaves) {
    if (!isTextLeaf(leaf)) continue;
    const normalized = normalizeText(leaf.transformed);
    if (normalized.value !== leaf.transformed) {
      addRiskSummary({
        end: leaf.end,
        punctuationConverted: normalized.punctuationConverted,
        spacesNormalized: normalized.spacesNormalized,
        start: leaf.start,
      });
    }
    leaf.transformed = normalized.value;
    spacesNormalized += normalized.spacesNormalized;
    punctuationConverted += normalized.punctuationConverted;
    protectedNodes += normalized.protectedTokens;
  }

  const insertions = new Map<number, string>();
  let previous: TextLeaf | ProtectedTextLeaf | undefined;
  for (const leaf of leaves) {
    if (!isSpacingLeaf(leaf)) {
      previous = undefined;
      continue;
    }
    if (previous) {
      const left = boundaryCharacters(
        isTextLeaf(previous) ? previous.transformed : previous.visible,
      ).last;
      const right = boundaryCharacters(
        isTextLeaf(leaf) ? leaf.transformed : leaf.visible,
      ).first;
      const gap = source.slice(previous.end, leaf.start);
      if (
        needsMixedSpace(left, right) &&
        !gap.includes("\n") &&
        !new RegExp(horizontalWhitespace, "u").test(gap) &&
        !new RegExp(`${horizontalWhitespace}$`, "u").test(
          isTextLeaf(previous) ? previous.transformed : previous.visible,
        ) &&
        !new RegExp(`^${horizontalWhitespace}`, "u").test(
          isTextLeaf(leaf) ? leaf.transformed : leaf.visible,
        )
      ) {
        const common = commonPathLength(previous.path, leaf.path);
        const leaving = previous.path[common];
        const entering = leaf.path[common];
        const offset =
          leaving?.position?.end.offset ??
          entering?.position?.start.offset ??
          leaf.start;
        insertions.set(offset, " ");
        spacesNormalized += 1;
        addRiskSummary({
          end: Math.min(source.length, offset + 1),
          punctuationConverted: 0,
          spacesNormalized: 1,
          start: Math.max(0, offset - 1),
        });
      }
    }
    previous = leaf;
  }

  const replacements: {
    readonly end: number;
    readonly start: number;
    readonly value: string;
  }[] = [];
  for (const leaf of leaves) {
    if (
      isTextLeaf(leaf) &&
      source.slice(leaf.start, leaf.end) !== leaf.transformed
    ) {
      replacements.push({
        end: leaf.end,
        start: leaf.start,
        value: leaf.transformed,
      });
    }
  }
  for (const [start, value] of insertions) {
    replacements.push({ end: start, start, value });
  }
  replacements.sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  let markdown = source;
  for (const replacement of replacements) {
    markdown =
      markdown.slice(0, replacement.start) +
      replacement.value +
      markdown.slice(replacement.end);
  }
  return Object.freeze({
    markdown,
    protectedNodes: clampCounter(protectedNodes),
    punctuationConverted: clampCounter(punctuationConverted),
    riskSummaries: Object.freeze(riskSummaries),
    riskSummariesTruncated: riskSummaryCount > maximumRiskSummaries,
    spacesNormalized: clampCounter(spacesNormalized),
  });
}

export function preprocessMarkdownTypography(
  input: string | Uint8Array,
  profile: TypographyProfile,
): TypographyPreprocessResult {
  const original = decode(input);
  if (profile === "verbatim-v1") {
    const digest = sha256(original);
    return Object.freeze({
      markdown: original,
      provenance: Object.freeze({
        input_sha256: digest,
        output_sha256: digest,
        profile,
        protected_nodes: 0,
        punctuation_converted: 0,
        spaces_normalized: 0,
      }),
      riskSummaries: Object.freeze([]),
      riskSummariesTruncated: false,
    });
  }
  if (profile !== "zh-smart-v1") {
    throw new TypeError("Unsupported typography profile");
  }
  const bom = original.startsWith("\uFEFF") ? "\uFEFF" : "";
  const body = bom ? original.slice(1) : original;
  const transformed = preprocessBody(body);
  const markdown = `${bom}${transformed.markdown}`;
  const bomBytes = Buffer.byteLength(bom, "utf8");
  return Object.freeze({
    markdown,
    provenance: Object.freeze({
      input_sha256: sha256(original),
      output_sha256: sha256(markdown),
      profile,
      protected_nodes: transformed.protectedNodes,
      punctuation_converted: transformed.punctuationConverted,
      spaces_normalized: transformed.spacesNormalized,
    }),
    riskSummaries: Object.freeze(
      transformed.riskSummaries.map((summary) =>
        Object.freeze({
          ...summary,
          end_byte: summary.end_byte + bomBytes,
          start_byte: summary.start_byte + bomBytes,
        }),
      ),
    ),
    riskSummariesTruncated: transformed.riskSummariesTruncated,
  });
}
