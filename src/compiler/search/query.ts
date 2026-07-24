export interface NormalizedSearchQuery {
  readonly codePointLength: number;
  readonly ftsLiteralPhrase: string;
  readonly normalized: string;
  readonly scope: "metadata_heading_body" | "metadata_heading_only";
}

export function normalizeSearchQuery(value: string): NormalizedSearchQuery {
  const normalized = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC")
    .trim();
  const codePointLength = [...normalized].length;
  if (codePointLength < 1 || codePointLength > 200) {
    throw new Error("SEARCH_QUERY_LENGTH_INVALID");
  }
  return Object.freeze({
    codePointLength,
    ftsLiteralPhrase: `"${normalized.replaceAll('"', '""')}"`,
    normalized,
    scope:
      codePointLength >= 3 ? "metadata_heading_body" : "metadata_heading_only",
  });
}
