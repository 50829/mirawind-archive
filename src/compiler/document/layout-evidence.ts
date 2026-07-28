import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { JSONParser, TokenType } from "@streamparser/json";

const maximumSidecarBytes = 128 * 1024 * 1024;
const maximumRecords = 20_000;
const maximumTextLength = 4_000;
const maximumStringTokenLength = 64 * 1024;
const maximumJsonDepth = 32;

type BoundingBox = readonly [number, number, number, number];

export interface LayoutEvidenceRecord {
  readonly bbox?: BoundingBox;
  readonly groupBbox?: BoundingBox;
  readonly groupId?: number;
  readonly groupItemCount?: number;
  readonly groupItemIndex?: number;
  readonly pageIndex: number;
  readonly pageLabelSupplemented?: boolean;
  readonly sourceOrder?: number;
  readonly text?: string;
  readonly textLevel?: number;
  readonly type: string;
}

export interface LayoutEvidenceDiagnostic {
  readonly code:
    | "LAYOUT_EVIDENCE_INVALID"
    | "LAYOUT_EVIDENCE_LIMIT_EXCEEDED"
    | "LAYOUT_EVIDENCE_UNAVAILABLE";
}

export interface LayoutEvidence {
  readonly diagnostics: readonly LayoutEvidenceDiagnostic[];
  readonly records: readonly LayoutEvidenceRecord[];
  readonly source: "content-list" | "native-pdf" | "none" | "ocr";
}

export interface PrintedLayoutRow {
  readonly indent: number;
  readonly pageIndex: number;
  readonly text: string;
}

const pageSuffix =
  /(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+|\s{2,})\s*(?:\d+|[ivxlcdm]+)\s*$/iu;
const numberingPrefix =
  /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|part)\s*[0-9ivxlcdm]+|附录|\d+(?:\s*\.\s*\d+){0,3})(?:\s|、|:|：|$)/iu;
const detachedSectionNumber = /^\d+(?:\s*\.\s*\d+){1,3}\s*\.?\s*$/u;
const leadingTechnicalNumber = /^\d{2,}(?:\s*\.\s*\d+)+\s+/u;
const standalonePageLabel = /^(?:\d{1,5}|[ivxlcdm]+)$/iu;
const trailingPageLabel =
  /^(?<title>.+?)(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+|\s+)\s*(?<page>\d{1,5}|[ivxlcdm]+)\s*$/iu;

class EvidenceLimitError extends Error {}
class EvidenceInvalidError extends Error {}
class EvidenceCanceledError extends Error {
  constructor() {
    super("LAYOUT_EVIDENCE_CANCELED");
  }
}

function checkCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EvidenceCanceledError();
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function boundingBox(value: unknown): BoundingBox | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(finiteCoordinate) ||
    Number(value[2]) <= Number(value[0]) ||
    Number(value[3]) <= Number(value[1])
  ) {
    return undefined;
  }
  return Object.freeze(value.map(Number)) as BoundingBox;
}

function baseRecord(value: unknown):
  | {
      readonly bbox?: BoundingBox;
      readonly pageIndex: number;
      readonly text?: string;
      readonly textLevel?: number;
      readonly type: string;
      readonly value: Readonly<Record<string, unknown>>;
    }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    !Number.isSafeInteger(record.page_idx) ||
    Number(record.page_idx) < 0 ||
    Number(record.page_idx) > 100_000 ||
    typeof record.type !== "string" ||
    record.type.length < 1 ||
    record.type.length > 40
  ) {
    return;
  }
  const text =
    typeof record.text === "string" && record.text.length <= maximumTextLength
      ? record.text
      : undefined;
  const textLevel =
    Number.isSafeInteger(record.text_level) &&
    Number(record.text_level) > 0 &&
    Number(record.text_level) <= 20
      ? Number(record.text_level)
      : undefined;
  const bbox = boundingBox(record.bbox);
  return {
    ...(bbox ? { bbox } : {}),
    pageIndex: Number(record.page_idx),
    ...(text === undefined ? {} : { text }),
    ...(textLevel === undefined ? {} : { textLevel }),
    type: record.type,
    value: record,
  };
}

function projectRecord(
  value: unknown,
  groupId: number,
  sourceOrder: { value: number },
): {
  readonly invalid: boolean;
  readonly records: readonly LayoutEvidenceRecord[];
} {
  const base = baseRecord(value);
  if (!base) return { invalid: true, records: Object.freeze([]) };
  const rawListItems = base.value.list_items;
  const oversizedText =
    typeof base.value.text === "string" &&
    base.value.text.length > maximumTextLength;
  if (rawListItems !== undefined) {
    if (!Array.isArray(rawListItems)) {
      return { invalid: true, records: Object.freeze([]) };
    }
    if (rawListItems.length > maximumRecords) throw new EvidenceLimitError();
    const records: LayoutEvidenceRecord[] = [];
    let invalid = oversizedText;
    for (const [itemIndex, item] of rawListItems.entries()) {
      if (
        typeof item !== "string" ||
        item.length < 1 ||
        item.length > maximumTextLength
      ) {
        invalid = true;
        continue;
      }
      records.push(
        Object.freeze({
          ...(base.bbox ? { groupBbox: base.bbox } : {}),
          groupId,
          groupItemCount: rawListItems.length,
          groupItemIndex: itemIndex,
          pageIndex: base.pageIndex,
          sourceOrder: sourceOrder.value++,
          text: item,
          ...(base.textLevel === undefined
            ? {}
            : { textLevel: base.textLevel }),
          type: base.type,
        }),
      );
    }
    return { invalid, records: Object.freeze(records) };
  }
  return {
    invalid: oversizedText,
    records: Object.freeze([
      Object.freeze({
        ...(base.bbox ? { bbox: base.bbox } : {}),
        pageIndex: base.pageIndex,
        sourceOrder: sourceOrder.value++,
        ...(base.text === undefined ? {} : { text: base.text }),
        ...(base.textLevel === undefined ? {} : { textLevel: base.textLevel }),
        type: base.type,
      }),
    ]),
  };
}

function diagnostic(code: LayoutEvidenceDiagnostic["code"]): LayoutEvidence {
  return Object.freeze({
    diagnostics: Object.freeze([Object.freeze({ code })]),
    records: Object.freeze([]),
    source: "none" as const,
  });
}

async function streamFlatRecords(
  path: string,
  signal: AbortSignal | undefined,
): Promise<{
  readonly invalid: boolean;
  readonly records: readonly LayoutEvidenceRecord[];
}> {
  const records: LayoutEvidenceRecord[] = [];
  const sourceOrder = { value: 0 };
  let inputRecords = 0;
  let invalid = false;
  let jsonDepth = 0;
  let firstToken: TokenType | undefined;
  const parser = new JSONParser({
    emitPartialTokens: true,
    keepStack: false,
    numberBufferSize: 64 * 1024,
    paths: ["$.*"],
    stringBufferSize: 64 * 1024,
  });
  parser.onToken = ({ partial, token, value }) => {
    if (partial) {
      if (
        token === TokenType.STRING &&
        String(value).length > maximumStringTokenLength
      ) {
        throw new EvidenceLimitError();
      }
      return;
    }
    firstToken ??= token;
    if (token === TokenType.LEFT_BRACE || token === TokenType.LEFT_BRACKET) {
      jsonDepth += 1;
      if (jsonDepth > maximumJsonDepth) throw new EvidenceLimitError();
    } else if (
      token === TokenType.RIGHT_BRACE ||
      token === TokenType.RIGHT_BRACKET
    ) {
      jsonDepth -= 1;
    } else if (
      token === TokenType.STRING &&
      typeof value === "string" &&
      value.length > maximumStringTokenLength
    ) {
      throw new EvidenceLimitError();
    }
  };
  parser.onValue = ({ value }) => {
    checkCanceled(signal);
    inputRecords += 1;
    if (inputRecords > maximumRecords) throw new EvidenceLimitError();
    const projected = projectRecord(value, inputRecords - 1, sourceOrder);
    invalid ||= projected.invalid;
    records.push(...projected.records);
    if (records.length > maximumRecords) throw new EvidenceLimitError();
  };

  let bytes = 0;
  const stream = createReadStream(path, { highWaterMark: 64 * 1024 });
  try {
    for await (const chunk of stream) {
      checkCanceled(signal);
      bytes += chunk.byteLength;
      if (bytes > maximumSidecarBytes) throw new EvidenceLimitError();
      parser.write(chunk);
    }
    checkCanceled(signal);
    if (!parser.isEnded) parser.end();
    if (firstToken !== TokenType.LEFT_BRACKET || jsonDepth !== 0) {
      throw new EvidenceInvalidError();
    }
    return Object.freeze({ invalid, records: Object.freeze(records) });
  } finally {
    stream.destroy();
  }
}

/** Reads the bounded flat MinerU projection beside the selected Markdown. */
export async function readMineruLayoutEvidence(
  markdownPathInput: string,
  signal?: AbortSignal,
): Promise<LayoutEvidence> {
  checkCanceled(signal);
  const markdownPath = resolve(markdownPathInput);
  const directory = dirname(markdownPath);
  const stem = basename(markdownPath, ".md");
  const names = await readdir(directory);
  checkCanceled(signal);
  const companionName = [
    `${stem}_content_list.json`,
    ...(basename(markdownPath) === "full.md" ? ["content_list.json"] : []),
  ].find((name) => names.includes(name));
  if (!companionName) return diagnostic("LAYOUT_EVIDENCE_UNAVAILABLE");
  try {
    const path = resolve(directory, companionName);
    const metadata = await lstat(path);
    checkCanceled(signal);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > maximumSidecarBytes
    ) {
      return diagnostic("LAYOUT_EVIDENCE_LIMIT_EXCEEDED");
    }
    const streamed = await streamFlatRecords(path, signal);
    return Object.freeze({
      diagnostics: Object.freeze(
        streamed.invalid
          ? [Object.freeze({ code: "LAYOUT_EVIDENCE_INVALID" as const })]
          : [],
      ),
      records: streamed.records,
      source: "content-list" as const,
    });
  } catch (error) {
    if (error instanceof EvidenceCanceledError) throw error;
    if (error instanceof EvidenceLimitError) {
      return diagnostic("LAYOUT_EVIDENCE_LIMIT_EXCEEDED");
    }
    return diagnostic("LAYOUT_EVIDENCE_INVALID");
  }
}

function placement(record: LayoutEvidenceRecord): BoundingBox | undefined {
  return record.bbox ?? record.groupBbox;
}

function pageLabel(value: string | undefined): string | undefined {
  const match = value?.trim().match(trailingPageLabel);
  if (!match?.groups?.title || !match.groups.page) return;
  const title = match.groups.title.trim();
  if (title.length < 2 || /^\d+(?:\s*\.\s*\d+){0,3}$/u.test(title)) return;
  return match.groups.page.toLocaleLowerCase("und");
}

function numericPageLabel(value: string): number | undefined {
  if (/^\d{1,5}$/u.test(value)) return Number(value);
  if (!/^[ivxlcdm]+$/iu.test(value)) return;
  const values: Readonly<Record<string, number>> = Object.freeze({
    c: 100,
    d: 500,
    i: 1,
    l: 50,
    m: 1_000,
    v: 5,
    x: 10,
  });
  let total = 0;
  let previous = 0;
  for (const character of [...value.toLocaleLowerCase("und")].reverse()) {
    const current = values[character];
    if (!current) return;
    total += current < previous ? -current : current;
    previous = current;
  }
  return total > 0 ? total : undefined;
}

interface PageLabelCandidate {
  readonly centerY: number;
  readonly label: string;
}

function supplementalPageLabels(
  evidence: LayoutEvidence,
  pageIndex: number,
): readonly PageLabelCandidate[] {
  return Object.freeze(
    evidence.records
      .flatMap((record) => {
        const text = record.text?.trim().toLocaleLowerCase("und");
        if (
          record.pageIndex !== pageIndex ||
          record.type !== "page-label" ||
          !text ||
          !standalonePageLabel.test(text) ||
          !record.bbox
        ) {
          return [];
        }
        return [
          Object.freeze({
            centerY: (record.bbox[1] + record.bbox[3]) / 2,
            label: text,
          }),
        ];
      })
      .sort((left, right) => left.centerY - right.centerY),
  );
}

function maximumPageBottom(
  records: readonly LayoutEvidenceRecord[],
  pageIndex: number,
): number | undefined {
  const bottoms = records.flatMap((record) => {
    const box = placement(record);
    return record.pageIndex === pageIndex && box ? [box[3]] : [];
  });
  return bottoms.length > 0 ? Math.max(...bottoms) : undefined;
}

function monotonicPageLabel(
  records: readonly LayoutEvidenceRecord[],
  itemIndex: number,
  candidate: string,
): boolean {
  const value = numericPageLabel(candidate);
  if (value === undefined) return false;
  const before = [...records]
    .slice(0, itemIndex)
    .reverse()
    .map((record) => pageLabel(record.text))
    .find((label) => label !== undefined);
  const after = records
    .slice(itemIndex + 1)
    .map((record) => pageLabel(record.text))
    .find((label) => label !== undefined);
  const beforeValue = before ? numericPageLabel(before) : undefined;
  const afterValue = after ? numericPageLabel(after) : undefined;
  return (
    (beforeValue === undefined || value >= beforeValue) &&
    (afterValue === undefined || value <= afterValue)
  );
}

/**
 * Fills absent list-item page labels only when sidecar order and right-column
 * PDF tokens establish a bounded, monotonic one-to-one geometric mapping.
 */
export function supplementMissingListPageLabels(
  base: LayoutEvidence,
  supplemental: LayoutEvidence,
): LayoutEvidence {
  if (base.source !== "content-list" || supplemental.records.length < 1) {
    return base;
  }
  const groups = new Map<string, LayoutEvidenceRecord[]>();
  for (const record of base.records) {
    if (
      record.groupId === undefined ||
      record.groupItemCount === undefined ||
      record.groupItemIndex === undefined ||
      !record.groupBbox ||
      !record.text
    ) {
      continue;
    }
    const key = `${record.pageIndex}/${record.groupId}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const replacements = new Map<LayoutEvidenceRecord, LayoutEvidenceRecord>();
  for (const records of groups.values()) {
    records.sort(
      (left, right) => (left.groupItemIndex ?? 0) - (right.groupItemIndex ?? 0),
    );
    const first = records[0];
    if (!first?.groupBbox || records.length !== first.groupItemCount) continue;
    const candidates = supplementalPageLabels(supplemental, first.pageIndex);
    if (candidates.length < 3) continue;
    const baseBottom = maximumPageBottom(base.records, first.pageIndex);
    const supplementalBottom = maximumPageBottom(
      supplemental.records,
      first.pageIndex,
    );
    if (!baseBottom || !supplementalBottom) continue;
    const groupHeight = first.groupBbox[3] - first.groupBbox[1];
    const roughSpacing =
      (groupHeight / records.length) * (supplementalBottom / baseBottom);
    if (!Number.isFinite(roughSpacing) || roughSpacing <= 0) continue;
    const used = new Set<PageLabelCandidate>();
    const anchors: { readonly index: number; readonly y: number }[] = [];
    let previousY = Number.NEGATIVE_INFINITY;
    for (const [index, record] of records.entries()) {
      const label = pageLabel(record.text);
      if (!label) continue;
      const roughY =
        (first.groupBbox[1] + ((index + 0.5) * groupHeight) / records.length) *
        (supplementalBottom / baseBottom);
      const match = candidates
        .filter(
          (candidate) =>
            !used.has(candidate) &&
            candidate.label === label &&
            candidate.centerY > previousY &&
            Math.abs(candidate.centerY - roughY) <= roughSpacing * 0.8,
        )
        .sort(
          (left, right) =>
            Math.abs(left.centerY - roughY) - Math.abs(right.centerY - roughY),
        )[0];
      if (!match) continue;
      used.add(match);
      previousY = match.centerY;
      anchors.push(Object.freeze({ index, y: match.centerY }));
    }
    if (anchors.length < 2) continue;
    const meanIndex =
      anchors.reduce((sum, anchor) => sum + anchor.index, 0) / anchors.length;
    const meanY =
      anchors.reduce((sum, anchor) => sum + anchor.y, 0) / anchors.length;
    const denominator = anchors.reduce(
      (sum, anchor) => sum + (anchor.index - meanIndex) ** 2,
      0,
    );
    if (denominator <= 0) continue;
    const slope =
      anchors.reduce(
        (sum, anchor) => sum + (anchor.index - meanIndex) * (anchor.y - meanY),
        0,
      ) / denominator;
    const intercept = meanY - slope * meanIndex;
    const residual = Math.max(
      ...anchors.map((anchor) =>
        Math.abs(anchor.y - (intercept + slope * anchor.index)),
      ),
    );
    if (
      slope < roughSpacing * 0.55 ||
      slope > roughSpacing * 1.8 ||
      residual > Math.max(8, slope * 0.35)
    ) {
      continue;
    }
    for (const [index, record] of records.entries()) {
      if (
        pageLabel(record.text) ||
        !record.text ||
        !numberingPrefix.test(record.text.trim())
      ) {
        continue;
      }
      const expectedY = intercept + slope * index;
      const match = candidates
        .filter(
          (candidate) =>
            !used.has(candidate) &&
            monotonicPageLabel(records, index, candidate.label) &&
            Math.abs(candidate.centerY - expectedY) <=
              Math.max(10, slope * 0.45),
        )
        .sort(
          (left, right) =>
            Math.abs(left.centerY - expectedY) -
            Math.abs(right.centerY - expectedY),
        )[0];
      if (!match) continue;
      used.add(match);
      replacements.set(
        record,
        Object.freeze({
          ...record,
          pageLabelSupplemented: true,
          text: `${record.text.trim()}  ${match.label}`,
        }),
      );
    }
  }
  if (replacements.size === 0) return base;
  return Object.freeze({
    ...base,
    records: Object.freeze(
      base.records.map((record) => replacements.get(record) ?? record),
    ),
  });
}

function columnStarts(
  records: readonly LayoutEvidenceRecord[],
): readonly number[] {
  const contentRecords = records.filter(
    (record) => !/^\s*(?:\d+|[ivxlcdm]+)\s*$/iu.test(record.text ?? ""),
  );
  const entryRecords = contentRecords.filter((record) => {
    const text = record.text?.trim() ?? "";
    return numberingPrefix.test(text) || pageSuffix.test(text);
  });
  const columnRecords =
    entryRecords.length >= 2 ? entryRecords : contentRecords;
  const boxes = (columnRecords.length > 0 ? columnRecords : records).flatMap(
    (record) => {
      const box = placement(record);
      return box ? [box] : [];
    },
  );
  if (boxes.length === 0) return Object.freeze([]);
  const left = Math.min(...boxes.map((box) => box[0]));
  const right = Math.max(...boxes.map((box) => box[2]));
  const pageWidth = Math.max(1, right - left);
  const narrow = boxes.filter((box) => box[2] - box[0] < pageWidth * 0.75);
  const starts = [
    ...new Set((narrow.length > 0 ? narrow : boxes).map((box) => box[0])),
  ].sort((first, second) => first - second);
  const threshold = Math.max(60, pageWidth * 0.12);
  const clusters: number[][] = [];
  for (const start of starts) {
    const cluster = clusters.at(-1);
    if (!cluster || start - (cluster.at(-1) ?? start) > threshold) {
      clusters.push([start]);
    } else {
      cluster.push(start);
    }
  }
  while (clusters.length > 3) {
    let closest = 0;
    let distance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < clusters.length - 1; index += 1) {
      const current = clusters[index];
      const next = clusters[index + 1];
      const gap = (next?.[0] ?? 0) - (current?.at(-1) ?? 0);
      if (gap < distance) {
        closest = index;
        distance = gap;
      }
    }
    const current = clusters[closest] ?? [];
    const next = clusters[closest + 1] ?? [];
    clusters.splice(closest, 2, [...current, ...next]);
  }
  return Object.freeze(
    clusters.map(
      (cluster) =>
        cluster.reduce((sum, value) => sum + value, 0) / cluster.length,
    ),
  );
}

function nearestColumn(left: number, starts: readonly number[]): number {
  let selected = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (const [index, start] of starts.entries()) {
    const candidate = Math.abs(left - start);
    if (candidate < distance) {
      selected = index;
      distance = candidate;
    }
  }
  return selected;
}

interface PositionedRecord {
  readonly box: BoundingBox;
  readonly column: number;
  readonly record: LayoutEvidenceRecord;
  readonly text: string;
}

function detachedTechnicalToken(
  first: PositionedRecord,
  second: PositionedRecord,
): { readonly main: PositionedRecord; readonly text: string } | undefined {
  for (const [main, fragment] of [
    [first, second],
    [second, first],
  ] as const) {
    const token = fragment.text.trim();
    const numbered =
      /^(?<prefix>\d+(?:\s*\.\s*\d+){0,3})(?<rest>\s+.*)?$/u.exec(main.text);
    if (
      !numbered?.groups?.prefix ||
      token.length < 2 ||
      token.length > 16 ||
      !/^[A-Za-z0-9+./-]+$/u.test(token) ||
      !/[A-Z]/u.test(token) ||
      /^[IVXLCDM]+$/u.test(token) ||
      fragment.box[0] < main.box[0] - 4 ||
      fragment.box[2] > main.box[2] + 4 ||
      new RegExp(
        `(?:^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:\\s|$)`,
        "u",
      ).test(main.text)
    ) {
      continue;
    }
    return Object.freeze({
      main,
      text: `${numbered.groups.prefix} ${token}${numbered.groups.rest ?? ""}`,
    });
  }
  return;
}

/** Produces column-first reading-order rows for printed-contents analysis. */
export function reconstructPrintedLayoutRows(
  evidence: LayoutEvidence,
): readonly PrintedLayoutRow[] {
  const byPage = new Map<number, LayoutEvidenceRecord[]>();
  for (const record of evidence.records) {
    if (
      record.type === "page-label" ||
      !record.text?.trim() ||
      !placement(record)
    ) {
      continue;
    }
    const page = byPage.get(record.pageIndex) ?? [];
    page.push(record);
    byPage.set(record.pageIndex, page);
  }
  const output: PrintedLayoutRow[] = [];
  for (const [pageIndex, records] of [...byPage].sort(
    (left, right) => left[0] - right[0],
  )) {
    const starts = columnStarts(records);
    const positioned: PositionedRecord[] = records.flatMap((record) => {
      const box = placement(record);
      const text = record.text?.trim();
      return box && text
        ? [
            {
              box,
              column: nearestColumn(box[0], starts),
              record,
              text,
            },
          ]
        : [];
    });
    positioned.sort(
      (left, right) =>
        left.column - right.column ||
        left.box[1] - right.box[1] ||
        (left.record.groupItemIndex ?? -1) -
          (right.record.groupItemIndex ?? -1) ||
        (left.record.sourceOrder ?? 0) - (right.record.sourceOrder ?? 0) ||
        left.box[0] - right.box[0],
    );
    const coalesced: PositionedRecord[] = [];
    for (const item of positioned) {
      const previous = coalesced.at(-1);
      const overlap = previous
        ? Math.max(
            0,
            Math.min(previous.box[3], item.box[3]) -
              Math.max(previous.box[1], item.box[1]),
          )
        : 0;
      const minimumHeight = previous
        ? Math.min(previous.box[3] - previous.box[1], item.box[3] - item.box[1])
        : 0;
      const horizontalOverlap = previous
        ? Math.max(
            0,
            Math.min(previous.box[2], item.box[2]) -
              Math.max(previous.box[0], item.box[0]),
          )
        : 0;
      const minimumWidth = previous
        ? Math.min(previous.box[2] - previous.box[0], item.box[2] - item.box[0])
        : 0;
      const restoredToken = previous
        ? detachedTechnicalToken(previous, item)
        : undefined;
      if (
        previous &&
        previous.column === item.column &&
        previous.record.groupId === undefined &&
        item.record.groupId === undefined &&
        overlap >= minimumHeight * 0.7 &&
        restoredToken
      ) {
        coalesced[coalesced.length - 1] = {
          box: Object.freeze([
            Math.min(previous.box[0], item.box[0]),
            Math.min(previous.box[1], item.box[1]),
            Math.max(previous.box[2], item.box[2]),
            Math.max(previous.box[3], item.box[3]),
          ]),
          column: restoredToken.main.column,
          record: restoredToken.main.record,
          text: restoredToken.text,
        };
      } else if (
        previous &&
        previous.column === item.column &&
        previous.record.groupId === undefined &&
        item.record.groupId === undefined &&
        overlap >= minimumHeight * 0.7 &&
        horizontalOverlap <= minimumWidth * 0.15
      ) {
        const fragments = [previous, item].sort(
          (left, right) => left.box[0] - right.box[0],
        );
        coalesced[coalesced.length - 1] = {
          box: Object.freeze([
            Math.min(previous.box[0], item.box[0]),
            Math.min(previous.box[1], item.box[1]),
            Math.max(previous.box[2], item.box[2]),
            Math.max(previous.box[3], item.box[3]),
          ]),
          column: previous.column,
          record: previous.record,
          text: fragments.map((fragment) => fragment.text).join(" "),
        };
      } else {
        coalesced.push(item);
      }
    }
    const columnLefts = new Map<number, number>();
    for (const item of positioned) {
      columnLefts.set(
        item.column,
        Math.min(columnLefts.get(item.column) ?? item.box[0], item.box[0]),
      );
    }
    let previousPositioned: PositionedRecord | undefined;
    for (const positionedRecord of coalesced) {
      const previous = output.at(-1);
      const verticalGap = previousPositioned
        ? positionedRecord.box[1] - previousPositioned.box[3]
        : Number.POSITIVE_INFINITY;
      const groupItem =
        positionedRecord.record.groupId !== undefined ||
        previousPositioned?.record.groupId !== undefined;
      if (
        previous &&
        previousPositioned &&
        !groupItem &&
        previous.pageIndex === pageIndex &&
        previousPositioned.column === positionedRecord.column &&
        verticalGap >=
          -Math.min(
            20,
            (previousPositioned.box[3] - previousPositioned.box[1]) * 0.75,
          ) &&
        verticalGap <= 30 &&
        numberingPrefix.test(previous.text) &&
        !pageSuffix.test(previous.text) &&
        (!numberingPrefix.test(positionedRecord.text) ||
          verticalGap < 0 ||
          (detachedSectionNumber.test(previous.text) &&
            leadingTechnicalNumber.test(positionedRecord.text))) &&
        pageSuffix.test(positionedRecord.text)
      ) {
        output[output.length - 1] = Object.freeze({
          ...previous,
          text: `${previous.text} ${positionedRecord.text}`,
        });
      } else {
        output.push(
          Object.freeze({
            indent:
              evidence.source === "native-pdf" || evidence.source === "ocr"
                ? positionedRecord.box[0] -
                  (columnLefts.get(positionedRecord.column) ??
                    positionedRecord.box[0])
                : positionedRecord.box[0],
            pageIndex,
            text: positionedRecord.text,
          }),
        );
      }
      previousPositioned = positionedRecord;
    }
  }
  return Object.freeze(output);
}
