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
const trailingLeader = /(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+)\s*$/u;
const numberingPrefix =
  /^(?:第\s*[0-9零〇一二三四五六七八九十百千]+\s*(?:章|篇|部分|部)|(?:chapter|part)\s*[0-9ivxlcdm]+|附录|\d+(?:\s*\.\s*\d+){0,3})(?:\s|、|:|：|$)/iu;
const detachedSectionNumber = /^\d+(?:\s*\.\s*\d+){1,3}\s*\.?\s*$/u;
const leadingTechnicalNumber = /^\d{2,}(?:\s*\.\s*\d+)+\s+/u;
const standalonePageLabel = /^(?:\d{1,5}|[ivxlcdm]+)$/iu;
const trailingPageLabel =
  /^(?<title>.+?)(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+|\s+)\s*(?<page>\d{1,5}|[ivxlcdm]+)\s*$/iu;

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

interface LayoutEvidenceIndex {
  readonly maximumBottomByPage: ReadonlyMap<number, number>;
  readonly recordsByPage: ReadonlyMap<number, readonly LayoutEvidenceRecord[]>;
}

interface PageLabelNeighbors {
  readonly after: readonly (number | undefined)[];
  readonly before: readonly (number | undefined)[];
}

function indexLayoutEvidence(evidence: LayoutEvidence): LayoutEvidenceIndex {
  const maximumBottomByPage = new Map<number, number>();
  const recordsByPage = new Map<number, LayoutEvidenceRecord[]>();
  for (const record of evidence.records) {
    const records = recordsByPage.get(record.pageIndex);
    if (records) records.push(record);
    else recordsByPage.set(record.pageIndex, [record]);
    const box = placement(record);
    if (box) {
      maximumBottomByPage.set(
        record.pageIndex,
        Math.max(maximumBottomByPage.get(record.pageIndex) ?? box[3], box[3]),
      );
    }
  }
  return Object.freeze({ maximumBottomByPage, recordsByPage });
}

function indexSupplementalPageLabels(
  evidence: LayoutEvidence,
  parsePageLabel: (value: string | undefined) => string | undefined,
): ReadonlyMap<number, readonly PageLabelCandidate[]> {
  const byPage = new Map<number, PageLabelCandidate[]>();
  for (const record of evidence.records) {
    const text = record.text?.trim().toLocaleLowerCase("und");
    const label =
      text && standalonePageLabel.test(text)
        ? text
        : evidence.source === "native-pdf"
          ? parsePageLabel(text)
          : undefined;
    if (
      (record.type !== "page-label" &&
        !(evidence.source === "native-pdf" && record.type === "text")) ||
      !label ||
      !record.bbox
    ) {
      continue;
    }
    const candidates = byPage.get(record.pageIndex);
    const candidate = Object.freeze({
      centerY: (record.bbox[1] + record.bbox[3]) / 2,
      label,
    });
    if (candidates) candidates.push(candidate);
    else byPage.set(record.pageIndex, [candidate]);
  }
  for (const candidates of byPage.values()) {
    candidates.sort((left, right) => left.centerY - right.centerY);
  }
  return byPage;
}

function pageLabelNeighbors(
  records: readonly LayoutEvidenceRecord[],
  parsePageLabel: (value: string | undefined) => string | undefined,
  parseNumericPageLabel: (value: string) => number | undefined,
): PageLabelNeighbors {
  const before: (number | undefined)[] = [];
  const after: (number | undefined)[] = [];
  let nearest: number | undefined;
  for (const [index, record] of records.entries()) {
    before[index] = nearest;
    const label = parsePageLabel(record.text);
    if (label !== undefined) nearest = parseNumericPageLabel(label);
  }
  nearest = undefined;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];
    after[index] = nearest;
    const label = parsePageLabel(record?.text);
    if (label !== undefined) nearest = parseNumericPageLabel(label);
  }
  return Object.freeze({ after, before });
}

function monotonicPageLabel(
  neighbors: PageLabelNeighbors,
  itemIndex: number,
  candidate: string,
  parseNumericPageLabel: (value: string) => number | undefined,
): boolean {
  const value = parseNumericPageLabel(candidate);
  if (value === undefined) return false;
  const beforeValue = neighbors.before[itemIndex];
  const afterValue = neighbors.after[itemIndex];
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
  const pageLabelByText = new Map<string, string | null>();
  const numericPageLabelByText = new Map<string, number | null>();
  const cachedPageLabel = (value: string | undefined): string | undefined => {
    if (value === undefined) return;
    const cached = pageLabelByText.get(value);
    if (cached !== undefined) return cached ?? undefined;
    const label = pageLabel(value);
    pageLabelByText.set(value, label ?? null);
    return label;
  };
  const cachedNumericPageLabel = (value: string): number | undefined => {
    const cached = numericPageLabelByText.get(value);
    if (cached !== undefined) return cached ?? undefined;
    const label = numericPageLabel(value);
    numericPageLabelByText.set(value, label ?? null);
    return label;
  };
  const baseIndex = indexLayoutEvidence(base);
  const supplementalIndex = indexLayoutEvidence(supplemental);
  const supplementalLabelsByPage = indexSupplementalPageLabels(
    supplemental,
    cachedPageLabel,
  );
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
    const records = groups.get(key);
    if (records) records.push(record);
    else groups.set(key, [record]);
  }
  const replacements = new Map<LayoutEvidenceRecord, LayoutEvidenceRecord>();
  for (const records of groups.values()) {
    records.sort(
      (left, right) => (left.groupItemIndex ?? 0) - (right.groupItemIndex ?? 0),
    );
    const first = records[0];
    if (!first?.groupBbox || records.length !== first.groupItemCount) continue;
    const candidates = supplementalLabelsByPage.get(first.pageIndex) ?? [];
    if (candidates.length < 3) continue;
    const baseBottom = baseIndex.maximumBottomByPage.get(first.pageIndex);
    const supplementalBottom = supplementalIndex.maximumBottomByPage.get(
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
      const label = cachedPageLabel(record.text);
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
    const neighbors = pageLabelNeighbors(
      records,
      cachedPageLabel,
      cachedNumericPageLabel,
    );
    for (const [index, record] of records.entries()) {
      if (
        cachedPageLabel(record.text) ||
        !record.text ||
        (!numberingPrefix.test(record.text.trim()) &&
          !trailingLeader.test(record.text.trim()))
      ) {
        continue;
      }
      const expectedY = intercept + slope * index;
      const match = candidates
        .filter(
          (candidate) =>
            !used.has(candidate) &&
            monotonicPageLabel(
              neighbors,
              index,
              candidate.label,
              cachedNumericPageLabel,
            ) &&
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
  const positionedPageIndexes = new Set(
    base.records.flatMap((record) =>
      record.bbox && record.text ? [record.pageIndex] : [],
    ),
  );
  for (const pageIndex of positionedPageIndexes) {
    const records = (baseIndex.recordsByPage.get(pageIndex) ?? [])
      .filter(
        (record) =>
          record.bbox &&
          record.text &&
          (cachedPageLabel(record.text) !== undefined ||
            trailingLeader.test(record.text.trim())),
      )
      .sort(
        (left, right) =>
          ((left.bbox?.[1] ?? 0) + (left.bbox?.[3] ?? 0)) / 2 -
          ((right.bbox?.[1] ?? 0) + (right.bbox?.[3] ?? 0)) / 2,
      );
    const candidates = supplementalLabelsByPage.get(pageIndex) ?? [];
    if (records.length < 3 || candidates.length < 3) continue;
    const baseBottom = baseIndex.maximumBottomByPage.get(pageIndex);
    const supplementalBottom =
      supplementalIndex.maximumBottomByPage.get(pageIndex);
    if (!baseBottom || !supplementalBottom) continue;
    const roughScale = supplementalBottom / baseBottom;
    const used = new Set<PageLabelCandidate>();
    const anchors: {
      readonly sourceY: number;
      readonly targetY: number;
    }[] = [];
    for (const record of records) {
      const label = cachedPageLabel(record.text);
      const box = record.bbox;
      if (!label || !box) continue;
      const sourceY = (box[1] + box[3]) / 2;
      const expectedY = sourceY * roughScale;
      const tolerance = Math.max(12, (box[3] - box[1]) * roughScale * 2);
      const match = candidates
        .filter(
          (candidate) =>
            !used.has(candidate) &&
            candidate.label === label &&
            Math.abs(candidate.centerY - expectedY) <= tolerance,
        )
        .sort(
          (left, right) =>
            Math.abs(left.centerY - expectedY) -
            Math.abs(right.centerY - expectedY),
        )[0];
      if (!match) continue;
      used.add(match);
      anchors.push(Object.freeze({ sourceY, targetY: match.centerY }));
    }
    if (anchors.length < 2) continue;
    const meanSource =
      anchors.reduce((sum, anchor) => sum + anchor.sourceY, 0) / anchors.length;
    const meanTarget =
      anchors.reduce((sum, anchor) => sum + anchor.targetY, 0) / anchors.length;
    const denominator = anchors.reduce(
      (sum, anchor) => sum + (anchor.sourceY - meanSource) ** 2,
      0,
    );
    if (denominator <= 0) continue;
    const slope =
      anchors.reduce(
        (sum, anchor) =>
          sum + (anchor.sourceY - meanSource) * (anchor.targetY - meanTarget),
        0,
      ) / denominator;
    const intercept = meanTarget - slope * meanSource;
    const residual = Math.max(
      ...anchors.map((anchor) =>
        Math.abs(anchor.targetY - (intercept + slope * anchor.sourceY)),
      ),
    );
    if (
      slope < roughScale * 0.55 ||
      slope > roughScale * 1.8 ||
      residual > 12
    ) {
      continue;
    }
    const neighbors = pageLabelNeighbors(
      records,
      cachedPageLabel,
      cachedNumericPageLabel,
    );
    for (const [index, record] of records.entries()) {
      const box = record.bbox;
      if (
        !box ||
        !record.text ||
        replacements.has(record) ||
        cachedPageLabel(record.text) ||
        !trailingLeader.test(record.text.trim())
      ) {
        continue;
      }
      const sourceY = (box[1] + box[3]) / 2;
      const expectedY = intercept + slope * sourceY;
      const tolerance = Math.max(12, (box[3] - box[1]) * slope * 2);
      const match = candidates
        .filter(
          (candidate) =>
            !used.has(candidate) &&
            monotonicPageLabel(
              neighbors,
              index,
              candidate.label,
              cachedNumericPageLabel,
            ) &&
            Math.abs(candidate.centerY - expectedY) <= tolerance,
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
  readonly closedByDetachedPageLabel?: boolean;
  readonly column: number;
  readonly record: LayoutEvidenceRecord;
  readonly text: string;
}

const raisedCharacter = new Map<string, string>([["𝑛", "ⁿ"]]);

function restoreRaisedFragments(
  records: readonly PositionedRecord[],
): PositionedRecord[] {
  const assignments = new Map<
    PositionedRecord,
    { readonly fragment: PositionedRecord; readonly text: string }[]
  >();
  const used = new Set<PositionedRecord>();
  for (const fragment of records) {
    const replacement = raisedCharacter.get(fragment.text.trim());
    if (!replacement || fragment.record.groupId !== undefined) continue;
    const fragmentHeight = fragment.box[3] - fragment.box[1];
    const centerX = (fragment.box[0] + fragment.box[2]) / 2;
    const main = records
      .filter((candidate) => {
        if (
          candidate === fragment ||
          candidate.column !== fragment.column ||
          candidate.record.groupId !== undefined ||
          raisedCharacter.has(candidate.text.trim()) ||
          trailingLeader.test(candidate.text.trim()) ||
          standalonePageLabel.test(candidate.text.trim())
        ) {
          return false;
        }
        const candidateHeight = candidate.box[3] - candidate.box[1];
        const overlap = Math.max(
          0,
          Math.min(candidate.box[3], fragment.box[3]) -
            Math.max(candidate.box[1], fragment.box[1]),
        );
        return (
          overlap >= Math.min(fragmentHeight, candidateHeight) * 0.45 &&
          fragment.box[1] <= candidate.box[1] + candidateHeight * 0.25 &&
          centerX >= candidate.box[0] &&
          centerX <= candidate.box[2] + candidateHeight
        );
      })
      .sort((left, right) => {
        const distance = (candidate: PositionedRecord) =>
          centerX < candidate.box[0]
            ? candidate.box[0] - centerX
            : centerX > candidate.box[2]
              ? centerX - candidate.box[2]
              : 0;
        return distance(left) - distance(right);
      })[0];
    if (!main) continue;
    assignments.set(main, [
      ...(assignments.get(main) ?? []),
      { fragment, text: replacement },
    ]);
    used.add(fragment);
  }
  return records.flatMap((record) => {
    if (used.has(record)) return [];
    const fragments = assignments.get(record);
    if (!fragments || fragments.length === 0) return [record];
    const characters = [...record.text];
    const width = Math.max(1, record.box[2] - record.box[0]);
    const insertions = new Map<number, string[]>();
    for (const { fragment, text } of fragments) {
      const centerX = (fragment.box[0] + fragment.box[2]) / 2;
      const boundary = Math.max(
        1,
        Math.min(
          characters.length,
          Math.round(((centerX - record.box[0]) / width) * characters.length),
        ),
      );
      insertions.set(boundary, [...(insertions.get(boundary) ?? []), text]);
    }
    let text = "";
    for (const [index, character] of characters.entries()) {
      text += character;
      text += (insertions.get(index + 1) ?? []).join("");
    }
    return [
      {
        ...record,
        box: Object.freeze([
          Math.min(
            record.box[0],
            ...fragments.map(({ fragment }) => fragment.box[0]),
          ),
          Math.min(
            record.box[1],
            ...fragments.map(({ fragment }) => fragment.box[1]),
          ),
          Math.max(
            record.box[2],
            ...fragments.map(({ fragment }) => fragment.box[2]),
          ),
          Math.max(
            record.box[3],
            ...fragments.map(({ fragment }) => fragment.box[3]),
          ),
        ]),
        text,
      },
    ];
  });
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
    const positioned = restoreRaisedFragments(
      records.flatMap((record) => {
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
      }),
    );
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
          ...(previous.closedByDetachedPageLabel ||
          item.closedByDetachedPageLabel
            ? { closedByDetachedPageLabel: true }
            : {}),
          column: restoredToken.main.column,
          record: restoredToken.main.record,
          text: restoredToken.text,
        };
      } else if (
        previous &&
        previous.column === item.column &&
        previous.record.groupId === undefined &&
        item.record.groupId === undefined &&
        overlap >= minimumHeight * 0.45 &&
        horizontalOverlap <= minimumWidth * 0.15
      ) {
        const fragments = [previous, item].sort(
          (left, right) => left.box[0] - right.box[0],
        );
        const rightmost = fragments[1];
        const leftmost = fragments[0];
        coalesced[coalesced.length - 1] = {
          box: Object.freeze([
            Math.min(previous.box[0], item.box[0]),
            Math.min(previous.box[1], item.box[1]),
            Math.max(previous.box[2], item.box[2]),
            Math.max(previous.box[3], item.box[3]),
          ]),
          closedByDetachedPageLabel:
            previous.closedByDetachedPageLabel ||
            item.closedByDetachedPageLabel ||
            (rightmost !== undefined &&
              leftmost !== undefined &&
              standalonePageLabel.test(rightmost.text.trim()) &&
              !standalonePageLabel.test(leftmost.text.trim())),
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
        !previousPositioned.closedByDetachedPageLabel &&
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
