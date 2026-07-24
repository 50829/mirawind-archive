export interface ByteRange {
  readonly end: number;
  readonly length: number;
  readonly start: number;
}

export type RangeParseResult =
  | { readonly kind: "full" }
  | { readonly kind: "range"; readonly range: ByteRange }
  | { readonly kind: "unsatisfiable" };

const rangePattern = /^bytes=(?:([0-9]+)-([0-9]*)|-([0-9]+))$/u;

function safeInteger(value: string): number | null {
  if (!/^[0-9]+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function parseSingleByteRange(
  header: string | null,
  sizeBytes: number,
): RangeParseResult {
  if (!header) return { kind: "full" };
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new TypeError("File size must be a non-negative safe integer");
  }
  const match = rangePattern.exec(header);
  if (!match || sizeBytes === 0) return { kind: "unsatisfiable" };

  const suffixText = match[3];
  if (suffixText !== undefined) {
    const suffix = safeInteger(suffixText);
    if (suffix === null || suffix === 0) return { kind: "unsatisfiable" };
    const length = Math.min(suffix, sizeBytes);
    return {
      kind: "range",
      range: {
        end: sizeBytes - 1,
        length,
        start: sizeBytes - length,
      },
    };
  }

  const startText = match[1];
  if (startText === undefined) return { kind: "unsatisfiable" };
  const start = safeInteger(startText);
  if (start === null || start >= sizeBytes) return { kind: "unsatisfiable" };
  const endText = match[2] ?? "";
  const requestedEnd =
    endText.length === 0 ? sizeBytes - 1 : safeInteger(endText);
  if (requestedEnd === null || requestedEnd < start) {
    return { kind: "unsatisfiable" };
  }
  const end = Math.min(requestedEnd, sizeBytes - 1);
  return {
    kind: "range",
    range: { end, length: end - start + 1, start },
  };
}
