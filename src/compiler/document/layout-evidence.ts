import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { JSONParser, TokenType } from "@streamparser/json";

const maximumSidecarBytes = 128 * 1024 * 1024;
const maximumRecords = 20_000;
const maximumTextLength = 4_000;
const maximumJsonDepth = 32;

type BoundingBox = readonly [number, number, number, number];

export interface LayoutEvidenceRecord {
  readonly bbox?: BoundingBox;
  readonly groupBbox?: BoundingBox;
  readonly groupId?: number;
  readonly groupItemCount?: number;
  readonly groupItemIndex?: number;
  readonly pageIndex: number;
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
  readonly source: "content-list" | "none";
}

export interface PrintedLayoutRow {
  readonly indent: number;
  readonly pageIndex: number;
  readonly text: string;
}

const pageSuffix =
  /(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+|\s{2,})\s*(?:\d+|[ivxlcdm]+)\s*$/iu;
const numberingPrefix =
  /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|part)\s*[0-9ivxlcdm]+|附录|\d+(?:\.\d+){0,3})(?:\s|、|:|：|$)/iu;

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
  if (rawListItems !== undefined) {
    if (!Array.isArray(rawListItems)) {
      return { invalid: true, records: Object.freeze([]) };
    }
    if (rawListItems.length > maximumRecords) throw new EvidenceLimitError();
    const records: LayoutEvidenceRecord[] = [];
    let invalid = false;
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
    invalid: false,
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
        String(value).length > maximumTextLength
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
      value.length > maximumTextLength
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

function columnStarts(
  records: readonly LayoutEvidenceRecord[],
): readonly number[] {
  const boxes = records.flatMap((record) => {
    const box = placement(record);
    return box ? [box] : [];
  });
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

/** Produces column-first reading-order rows for printed-contents analysis. */
export function reconstructPrintedLayoutRows(
  evidence: LayoutEvidence,
): readonly PrintedLayoutRow[] {
  const byPage = new Map<number, LayoutEvidenceRecord[]>();
  for (const record of evidence.records) {
    if (!record.text?.trim() || !placement(record)) continue;
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
    let previousPositioned: PositionedRecord | undefined;
    for (const positionedRecord of positioned) {
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
        verticalGap >= -2 &&
        verticalGap <= 30 &&
        numberingPrefix.test(previous.text) &&
        !pageSuffix.test(previous.text) &&
        !numberingPrefix.test(positionedRecord.text) &&
        pageSuffix.test(positionedRecord.text)
      ) {
        output[output.length - 1] = Object.freeze({
          ...previous,
          text: `${previous.text} ${positionedRecord.text}`,
        });
      } else {
        output.push(
          Object.freeze({
            indent: positionedRecord.box[0],
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
