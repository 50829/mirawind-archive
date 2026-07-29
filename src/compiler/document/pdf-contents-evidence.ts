import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { LayoutEvidenceRecord } from "@/compiler/document/layout-evidence";

export interface PdfContentsEvidenceDiagnostic {
  readonly code:
    | "PDF_CONTENTS_EVIDENCE_INVALID"
    | "PDF_CONTENTS_NATIVE_ABSENT"
    | "PDF_CONTENTS_NOT_DETECTED"
    | "PDF_CONTENTS_OCR_LOW_CONFIDENCE"
    | "PDF_CONTENTS_OCR_TIMEOUT"
    | "PDF_CONTENTS_TOOL_UNAVAILABLE";
  readonly pageIndex?: number;
}

export interface PdfContentsEvidence {
  readonly diagnostics: readonly PdfContentsEvidenceDiagnostic[];
  readonly inspectedPageIndices: readonly number[];
  readonly records: readonly LayoutEvidenceRecord[];
  readonly source: "native-pdf" | "none" | "ocr";
}

export interface PdfContentsEvidenceCommands {
  readonly pdfinfo: string;
  readonly pdftoppm: string;
  readonly pdftotext: string;
  readonly tesseract: string;
}

export interface PdfContentsEvidenceLimits {
  readonly aggregateTimeoutMs: number;
  readonly pageTimeoutMs: number;
}

const defaultCommands: PdfContentsEvidenceCommands = Object.freeze({
  pdfinfo: "pdfinfo",
  pdftoppm: "pdftoppm",
  pdftotext: "pdftotext",
  tesseract: "tesseract",
});
const defaultLimits: PdfContentsEvidenceLimits = Object.freeze({
  aggregateTimeoutMs: 10 * 60 * 1_000,
  pageTimeoutMs: 15_000,
});
const maximumPages = 48;
const maximumOutputBytes = 8 * 1024 * 1024;
const maximumRecords = 20_000;
const maximumTextLength = 4_000;
const contentsLabel =
  /^(?:目\s*录|简\s*目|brief\s+contents|contents|table\s+of\s+contents)$/iu;
const printedRow =
  /(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+|\s{2,})\s*(?:\d+|[ivxlcdm]+)\s*$/iu;

class ToolUnavailableError extends Error {}
class ProcessTimeoutError extends Error {}
class EvidenceCanceledError extends Error {}
class ProcessOutputError extends Error {}

function checkCanceled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EvidenceCanceledError();
}

function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process may already have exited.
    }
  }
}

async function runBounded(input: {
  readonly args: readonly string[];
  readonly command: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
}): Promise<string> {
  checkCanceled(input.signal);
  return new Promise<string>((resolvePromise, reject) => {
    const child = spawn(input.command, input.args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const finish = (error?: Error, output?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolvePromise(output ?? "");
    };
    const abort = () => {
      killProcessTree(child.pid);
      finish(new EvidenceCanceledError());
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maximumOutputBytes) {
        killProcessTree(child.pid);
        finish(new ProcessOutputError());
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ENOENT"
          ? new ToolUnavailableError(input.command)
          : new ProcessOutputError(),
      );
    });
    child.on("close", (code) => {
      if (code !== 0) finish(new ProcessOutputError());
      else finish(undefined, Buffer.concat(stdout).toString("utf8"));
    });
    input.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      killProcessTree(child.pid);
      finish(new ProcessTimeoutError());
    }, input.timeoutMs);
    timer.unref();
  });
}

function remainingTimeout(
  startedAt: number,
  aggregateTimeoutMs: number,
  pageTimeoutMs: number,
): number {
  return Math.max(
    1,
    Math.min(pageTimeoutMs, aggregateTimeoutMs - (Date.now() - startedAt)),
  );
}

function pageCountFromPdfInfo(value: string): number {
  const count = Number(/^Pages:\s+(\d+)\s*$/mu.exec(value)?.[1]);
  if (!Number.isSafeInteger(count) || count < 1 || count > 100_000) {
    throw new ProcessOutputError();
  }
  return count;
}

function legacyNativeRecords(
  value: string,
  pageLimit: number,
): {
  readonly candidatePages: readonly number[];
  readonly records: readonly LayoutEvidenceRecord[];
} {
  const pages = value.split("\f").slice(0, pageLimit);
  const records: LayoutEvidenceRecord[] = [];
  const candidatePages: number[] = [];
  let sourceOrder = 0;
  for (const [pageIndex, page] of pages.entries()) {
    const lines = page
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.length <= maximumTextLength);
    const rowCount = lines.filter((line) => printedRow.test(line)).length;
    if (
      lines.some((line) => contentsLabel.test(line.normalize("NFKC"))) ||
      rowCount >= 2
    ) {
      candidatePages.push(pageIndex);
      for (const text of lines) {
        records.push(
          Object.freeze({
            pageIndex,
            sourceOrder: sourceOrder++,
            text,
            type: "text",
          }),
        );
      }
    }
  }
  return Object.freeze({
    candidatePages: Object.freeze(candidatePages),
    records: Object.freeze(records.slice(0, maximumRecords)),
  });
}

interface NativePdfWord {
  readonly bottom: number;
  readonly left: number;
  readonly pageIndex: number;
  readonly right: number;
  readonly text: string;
  readonly top: number;
}

function removeNativeExtractionOrdinals(
  records: readonly LayoutEvidenceRecord[],
): readonly LayoutEvidenceRecord[] {
  const ordinalRow =
    /^(?<title>.+?(?:\.(?:\s*\.)+|…{1,}|·(?:\s*·)+|_(?:\s*_)+))\s*(?<page>\d+|[ivxlcdm]+)\s+(?<ordinal>\d{1,5})\s*$/iu;
  const reliablePages = new Set<number>();
  const byPage = new Map<
    number,
    readonly { readonly ordinal: number; readonly sourceOrder: number }[]
  >();
  for (const record of records) {
    const match = ordinalRow.exec(record.text ?? "");
    const ordinal = Number(match?.groups?.ordinal);
    if (!Number.isSafeInteger(ordinal)) continue;
    byPage.set(record.pageIndex, [
      ...(byPage.get(record.pageIndex) ?? []),
      { ordinal, sourceOrder: record.sourceOrder ?? 0 },
    ]);
  }
  for (const [pageIndex, rows] of byPage) {
    const ordered = [...rows].sort(
      (left, right) => left.sourceOrder - right.sourceOrder,
    );
    if (ordered.length < 4) continue;
    let consecutive = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      if (
        (ordered[index]?.ordinal ?? 0) ===
        (ordered[index - 1]?.ordinal ?? 0) + 1
      ) {
        consecutive += 1;
      }
    }
    if (consecutive / (ordered.length - 1) >= 0.8) {
      reliablePages.add(pageIndex);
    }
  }
  if (reliablePages.size === 0) return records;
  return Object.freeze(
    records.map((record) => {
      if (!reliablePages.has(record.pageIndex) || !record.text) return record;
      const match = ordinalRow.exec(record.text);
      if (!match?.groups?.title || !match.groups.page) return record;
      return Object.freeze({
        ...record,
        text: `${match.groups.title.trim()} ${match.groups.page}`,
      });
    }),
  );
}

function nativeTsvRecords(
  value: string,
  pageLimit: number,
):
  | {
      readonly candidatePages: readonly number[];
      readonly records: readonly LayoutEvidenceRecord[];
    }
  | undefined {
  const rows = value.split(/\r?\n/u);
  const header = rows.shift()?.split("\t");
  if (
    !header ||
    ![
      "level",
      "page_num",
      "par_num",
      "block_num",
      "line_num",
      "left",
      "top",
      "width",
      "height",
      "conf",
      "text",
    ].every((name) => header.includes(name))
  ) {
    return;
  }
  const indexes = new Map(header.map((name, index) => [name, index]));
  const groups = new Map<string, NativePdfWord[]>();
  for (const row of rows) {
    if (!row.trim()) continue;
    const fields = row.split("\t");
    if (fields[indexes.get("level") ?? -1] !== "5") continue;
    const text = fields[indexes.get("text") ?? -1]?.trim() ?? "";
    const pageNumber = Number(fields[indexes.get("page_num") ?? -1]);
    const confidence = Number(fields[indexes.get("conf") ?? -1]);
    const left = Number(fields[indexes.get("left") ?? -1]);
    const top = Number(fields[indexes.get("top") ?? -1]);
    const width = Number(fields[indexes.get("width") ?? -1]);
    const height = Number(fields[indexes.get("height") ?? -1]);
    if (
      !text ||
      text.length > maximumTextLength ||
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > pageLimit ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      ![left, top, width, height].every(Number.isFinite) ||
      left < 0 ||
      top < 0 ||
      width <= 0 ||
      height <= 0
    ) {
      continue;
    }
    const key = [
      pageNumber,
      fields[indexes.get("par_num") ?? -1] ?? "",
      fields[indexes.get("block_num") ?? -1] ?? "",
      fields[indexes.get("line_num") ?? -1] ?? "",
    ].join("/");
    groups.set(key, [
      ...(groups.get(key) ?? []),
      Object.freeze({
        bottom: top + height,
        left,
        pageIndex: pageNumber - 1,
        right: left + width,
        text,
        top,
      }),
    ]);
  }
  const rawRecords = [...groups.values()].flatMap((words, sourceOrder) => {
    const first = words[0];
    if (!first) return [];
    const text = words
      .map((word) => word.text)
      .join(" ")
      .slice(0, maximumTextLength);
    return [
      Object.freeze({
        bbox: Object.freeze([
          Math.min(...words.map((word) => word.left)),
          Math.min(...words.map((word) => word.top)),
          Math.max(...words.map((word) => word.right)),
          Math.max(...words.map((word) => word.bottom)),
        ]) as readonly [number, number, number, number],
        pageIndex: first.pageIndex,
        sourceOrder,
        text,
        type: "text",
      }),
    ];
  });
  const allRecords = removeNativeExtractionOrdinals(rawRecords);
  const recordsByPage = new Map<number, LayoutEvidenceRecord[]>();
  for (const record of allRecords) {
    recordsByPage.set(record.pageIndex, [
      ...(recordsByPage.get(record.pageIndex) ?? []),
      record,
    ]);
  }
  const candidatePages = [...recordsByPage]
    .filter(([, records]) => {
      const rowCount = records.filter((record) =>
        printedRow.test(record.text ?? ""),
      ).length;
      return (
        records.some((record) =>
          contentsLabel.test((record.text ?? "").normalize("NFKC")),
        ) || rowCount >= 2
      );
    })
    .map(([pageIndex]) => pageIndex)
    .sort((left, right) => left - right);
  const candidatePageSet = new Set(candidatePages);
  return Object.freeze({
    candidatePages: Object.freeze(candidatePages),
    records: Object.freeze(
      allRecords
        .filter((record) => candidatePageSet.has(record.pageIndex))
        .slice(0, maximumRecords),
    ),
  });
}

function nativeRecords(
  value: string,
  pageLimit: number,
): {
  readonly candidatePages: readonly number[];
  readonly records: readonly LayoutEvidenceRecord[];
} {
  return (
    nativeTsvRecords(value, pageLimit) ?? legacyNativeRecords(value, pageLimit)
  );
}

interface TsvWord {
  readonly block: string;
  readonly confidence: number;
  readonly height: number;
  readonly left: number;
  readonly line: string;
  readonly paragraph: string;
  readonly text: string;
  readonly top: number;
  readonly width: number;
}

function tsvRecords(
  value: string,
  pageIndex: number,
): {
  readonly lowConfidence: boolean;
  readonly records: readonly LayoutEvidenceRecord[];
} {
  const rows = value.split(/\r?\n/u);
  const header = rows.shift()?.split("\t");
  if (
    !header ||
    ![
      "block_num",
      "par_num",
      "line_num",
      "left",
      "top",
      "width",
      "height",
      "conf",
      "text",
    ].every((name) => header.includes(name))
  ) {
    throw new ProcessOutputError();
  }
  const index = new Map(header.map((name, itemIndex) => [name, itemIndex]));
  const words: TsvWord[] = [];
  for (const row of rows) {
    if (!row.trim()) continue;
    const fields = row.split("\t");
    const text = fields[index.get("text") ?? -1]?.trim() ?? "";
    const confidence = Number(fields[index.get("conf") ?? -1]);
    if (!text || !Number.isFinite(confidence) || confidence < 0) continue;
    const number = (name: string) => Number(fields[index.get(name) ?? -1]);
    const left = number("left");
    const top = number("top");
    const width = number("width");
    const height = number("height");
    if (
      ![left, top, width, height].every(Number.isFinite) ||
      left < 0 ||
      top < 0 ||
      width <= 0 ||
      height <= 0
    ) {
      continue;
    }
    words.push({
      block: fields[index.get("block_num") ?? -1] ?? "",
      confidence,
      height,
      left,
      line: fields[index.get("line_num") ?? -1] ?? "",
      paragraph: fields[index.get("par_num") ?? -1] ?? "",
      text,
      top,
      width,
    });
  }
  const groups = new Map<string, TsvWord[]>();
  for (const word of words) {
    const key = `${word.block}/${word.paragraph}/${word.line}`;
    groups.set(key, [...(groups.get(key) ?? []), word]);
  }
  const lineRecords = [...groups.values()].flatMap((line, sourceOrder) => {
    const confidence =
      line.reduce((sum, word) => sum + word.confidence, 0) / line.length;
    const text = line
      .map((word) => word.text)
      .join(" ")
      .slice(0, maximumTextLength);
    if (!text || confidence < 40) return [];
    const left = Math.min(...line.map((word) => word.left));
    const top = Math.min(...line.map((word) => word.top));
    const right = Math.max(...line.map((word) => word.left + word.width));
    const bottom = Math.max(...line.map((word) => word.top + word.height));
    return [
      Object.freeze({
        bbox: Object.freeze([left, top, right, bottom]) as readonly [
          number,
          number,
          number,
          number,
        ],
        pageIndex,
        sourceOrder,
        text,
        type: "text",
      }),
    ];
  });
  const maximumRight = Math.max(
    0,
    ...words.map((word) => word.left + word.width),
  );
  const rightColumnStart = maximumRight - Math.max(80, maximumRight * 0.12);
  const pageLabelRecords = words.flatMap((word, index) => {
    if (
      word.confidence < 60 ||
      word.left < rightColumnStart ||
      !/^(?:\d{1,5}|[ivxlcdm]+)$/iu.test(word.text)
    ) {
      return [];
    }
    return [
      Object.freeze({
        bbox: Object.freeze([
          word.left,
          word.top,
          word.left + word.width,
          word.top + word.height,
        ]) as readonly [number, number, number, number],
        pageIndex,
        sourceOrder: lineRecords.length + index,
        text: word.text,
        type: "page-label",
      }),
    ];
  });
  const records = [...lineRecords, ...pageLabelRecords];
  return Object.freeze({
    lowConfidence: words.length > 0 && records.length === 0,
    records: Object.freeze(records.slice(0, maximumRecords)),
  });
}

function diagnostic(
  code: PdfContentsEvidenceDiagnostic["code"],
  pageIndex?: number,
): PdfContentsEvidenceDiagnostic {
  return Object.freeze({
    code,
    ...(pageIndex === undefined ? {} : { pageIndex }),
  });
}

export async function readPdfContentsEvidence(input: {
  readonly allowOcr?: boolean;
  readonly commands?: Partial<PdfContentsEvidenceCommands>;
  readonly limits?: Partial<PdfContentsEvidenceLimits>;
  readonly pageIndices?: readonly number[];
  readonly pdfPath: string;
  readonly recoverPageLabels?: boolean;
  readonly signal?: AbortSignal;
  readonly temporaryRoot: string;
}): Promise<PdfContentsEvidence> {
  const commands = Object.freeze({ ...defaultCommands, ...input.commands });
  const limits = Object.freeze({ ...defaultLimits, ...input.limits });
  if (
    !Number.isSafeInteger(limits.pageTimeoutMs) ||
    !Number.isSafeInteger(limits.aggregateTimeoutMs) ||
    limits.pageTimeoutMs < 1 ||
    limits.pageTimeoutMs > defaultLimits.pageTimeoutMs ||
    limits.aggregateTimeoutMs < 1 ||
    limits.aggregateTimeoutMs > defaultLimits.aggregateTimeoutMs
  ) {
    throw new TypeError("PDF_CONTENTS_EVIDENCE_LIMIT_INVALID");
  }
  const pdfPath = resolve(input.pdfPath);
  const temporaryRoot = resolve(input.temporaryRoot);
  const startedAt = Date.now();
  const diagnostics: PdfContentsEvidenceDiagnostic[] = [];
  let workspace: string | undefined;
  try {
    const pdfInfo = await runBounded({
      args: [pdfPath],
      command: commands.pdfinfo,
      ...(input.signal ? { signal: input.signal } : {}),
      timeoutMs: remainingTimeout(
        startedAt,
        limits.aggregateTimeoutMs,
        limits.pageTimeoutMs,
      ),
    });
    const pageCount = pageCountFromPdfInfo(pdfInfo);
    const pageLimit = Math.min(maximumPages, pageCount);
    const requestedPages = input.pageIndices
      ? [...input.pageIndices]
      : Array.from({ length: pageLimit }, (_value, index) => index);
    if (
      requestedPages.length < 1 ||
      requestedPages.length > maximumPages ||
      requestedPages.some(
        (pageIndex, index) =>
          !Number.isSafeInteger(pageIndex) ||
          pageIndex < 0 ||
          pageIndex >= pageLimit ||
          (index > 0 && pageIndex <= (requestedPages[index - 1] ?? -1)),
      )
    ) {
      throw new RangeError("PDF_CONTENTS_EVIDENCE_PAGE_LIMIT");
    }
    const nativeText = await runBounded({
      args: ["-f", "1", "-l", String(pageLimit), "-tsv", pdfPath, "-"],
      command: commands.pdftotext,
      ...(input.signal ? { signal: input.signal } : {}),
      timeoutMs: remainingTimeout(
        startedAt,
        limits.aggregateTimeoutMs,
        limits.pageTimeoutMs,
      ),
    });
    const native = nativeRecords(nativeText, pageLimit);
    if (native.records.length > 0) {
      return Object.freeze({
        diagnostics: Object.freeze(diagnostics),
        inspectedPageIndices: native.candidatePages,
        records: native.records,
        source: "native-pdf" as const,
      });
    }
    diagnostics.push(diagnostic("PDF_CONTENTS_NATIVE_ABSENT"));
    if (input.allowOcr === false) {
      return Object.freeze({
        diagnostics: Object.freeze(diagnostics),
        inspectedPageIndices: Object.freeze([]),
        records: Object.freeze([]),
        source: "none" as const,
      });
    }
    workspace = await mkdtemp(join(temporaryRoot, "ocr-"));
    const records: LayoutEvidenceRecord[] = [];
    const inspected: number[] = [];
    for (const pageIndex of requestedPages) {
      checkCanceled(input.signal);
      if (Date.now() - startedAt >= limits.aggregateTimeoutMs) {
        diagnostics.push(diagnostic("PDF_CONTENTS_OCR_TIMEOUT", pageIndex));
        break;
      }
      const pageStartedAt = Date.now();
      const stem = join(
        workspace,
        `page-${String(pageIndex + 1).padStart(4, "0")}`,
      );
      try {
        await runBounded({
          args: [
            "-f",
            String(pageIndex + 1),
            "-l",
            String(pageIndex + 1),
            "-r",
            "150",
            "-png",
            "-singlefile",
            pdfPath,
            stem,
          ],
          command: commands.pdftoppm,
          ...(input.signal ? { signal: input.signal } : {}),
          timeoutMs: remainingTimeout(
            startedAt,
            limits.aggregateTimeoutMs,
            limits.pageTimeoutMs,
          ),
        });
        const imagePath = `${stem}.png`;
        await readFile(imagePath);
        const pageRemaining = Math.max(
          1,
          limits.pageTimeoutMs - (Date.now() - pageStartedAt),
        );
        const tsv = await runBounded({
          args: [imagePath, "stdout", "-l", "eng+chi_sim", "--psm", "6", "tsv"],
          command: commands.tesseract,
          ...(input.signal ? { signal: input.signal } : {}),
          timeoutMs: remainingTimeout(
            startedAt,
            limits.aggregateTimeoutMs,
            pageRemaining,
          ),
        });
        const parsed = tsvRecords(tsv, pageIndex);
        const pageRecords = [...parsed.records];
        if (input.recoverPageLabels) {
          try {
            const pageLabelTsv = await runBounded({
              args: [
                imagePath,
                "stdout",
                "-l",
                "eng+chi_sim",
                "--psm",
                "3",
                "tsv",
              ],
              command: commands.tesseract,
              ...(input.signal ? { signal: input.signal } : {}),
              timeoutMs: remainingTimeout(
                startedAt,
                limits.aggregateTimeoutMs,
                Math.max(
                  1,
                  limits.pageTimeoutMs - (Date.now() - pageStartedAt),
                ),
              ),
            });
            const supplementalLabels = tsvRecords(
              pageLabelTsv,
              pageIndex,
            ).records.filter((record) => record.type === "page-label");
            const existing = new Set(
              pageRecords.map(
                (record) =>
                  `${record.type}/${record.text ?? ""}/${record.bbox?.join(",") ?? ""}`,
              ),
            );
            pageRecords.push(
              ...supplementalLabels.filter(
                (record) =>
                  !existing.has(
                    `${record.type}/${record.text ?? ""}/${record.bbox?.join(",") ?? ""}`,
                  ),
              ),
            );
          } catch (error) {
            if (error instanceof EvidenceCanceledError) throw error;
            if (error instanceof ToolUnavailableError) throw error;
            diagnostics.push(
              diagnostic(
                error instanceof ProcessTimeoutError
                  ? "PDF_CONTENTS_OCR_TIMEOUT"
                  : "PDF_CONTENTS_EVIDENCE_INVALID",
                pageIndex,
              ),
            );
          }
        }
        if (parsed.lowConfidence && pageRecords.length === 0) {
          diagnostics.push(
            diagnostic("PDF_CONTENTS_OCR_LOW_CONFIDENCE", pageIndex),
          );
        }
        records.push(...pageRecords);
        inspected.push(pageIndex);
        if (records.length > maximumRecords) throw new ProcessOutputError();
      } catch (error) {
        if (error instanceof EvidenceCanceledError) throw error;
        if (error instanceof ToolUnavailableError) throw error;
        if (error instanceof ProcessTimeoutError) {
          diagnostics.push(diagnostic("PDF_CONTENTS_OCR_TIMEOUT", pageIndex));
          continue;
        }
        diagnostics.push(
          diagnostic("PDF_CONTENTS_EVIDENCE_INVALID", pageIndex),
        );
      }
    }
    if (
      records.length === 0 &&
      !diagnostics.some((item) =>
        [
          "PDF_CONTENTS_EVIDENCE_INVALID",
          "PDF_CONTENTS_OCR_LOW_CONFIDENCE",
          "PDF_CONTENTS_OCR_TIMEOUT",
        ].includes(item.code),
      )
    ) {
      diagnostics.push(diagnostic("PDF_CONTENTS_NOT_DETECTED"));
    }
    return Object.freeze({
      diagnostics: Object.freeze(diagnostics.slice(0, 100)),
      inspectedPageIndices: Object.freeze(inspected),
      records: Object.freeze(records.slice(0, maximumRecords)),
      source: records.length > 0 ? ("ocr" as const) : ("none" as const),
    });
  } catch (error) {
    if (error instanceof EvidenceCanceledError) throw error;
    if (error instanceof ToolUnavailableError) {
      return Object.freeze({
        diagnostics: Object.freeze([
          ...diagnostics,
          diagnostic("PDF_CONTENTS_TOOL_UNAVAILABLE"),
        ]),
        inspectedPageIndices: Object.freeze([]),
        records: Object.freeze([]),
        source: "none" as const,
      });
    }
    if (error instanceof ProcessTimeoutError) {
      return Object.freeze({
        diagnostics: Object.freeze([
          ...diagnostics,
          diagnostic("PDF_CONTENTS_OCR_TIMEOUT"),
        ]),
        inspectedPageIndices: Object.freeze([]),
        records: Object.freeze([]),
        source: "none" as const,
      });
    }
    if (error instanceof RangeError) throw error;
    return Object.freeze({
      diagnostics: Object.freeze([
        ...diagnostics,
        diagnostic("PDF_CONTENTS_EVIDENCE_INVALID"),
      ]),
      inspectedPageIndices: Object.freeze([]),
      records: Object.freeze([]),
      source: "none" as const,
    });
  } finally {
    if (workspace) await rm(workspace, { force: true, recursive: true });
  }
}
