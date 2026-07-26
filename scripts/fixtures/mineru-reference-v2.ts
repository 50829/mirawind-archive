import { readFile } from "node:fs/promises";

export interface ReferenceAnchor {
  readonly root_index: number;
  readonly sha256: string;
}

export type ReferenceSemanticKind =
  | "part"
  | "chapter"
  | "section"
  | "appendix"
  | "frontmatter"
  | "backmatter"
  | "other";

export interface ReferenceContentsEntry {
  readonly body_heading_anchor: ReferenceAnchor | null;
  readonly entry_key: string;
  readonly expected_match: "matched" | "ambiguous" | "unmatched";
  readonly kind: ReferenceSemanticKind;
  readonly level: number;
  readonly page_label: string | null;
  readonly title: string;
}

export interface ReferenceContentsRegion {
  readonly canonical: boolean;
  readonly entries: readonly ReferenceContentsEntry[];
  readonly markdown_range: {
    readonly end: ReferenceAnchor;
    readonly start: ReferenceAnchor;
  };
  readonly pdf_page_indices: readonly number[];
  readonly region_key: string;
}

export type ReferenceHeadingDisposition =
  | {
      readonly kind: "excluded";
      readonly region_key: string;
    }
  | {
      readonly display_level: number;
      readonly display_title: string | null;
      readonly include_in_toc: boolean;
      readonly kind: "expected_body";
      readonly role: "frontmatter" | "body" | "appendix" | "backmatter";
      readonly starts_page: boolean;
    };

export interface ReferenceHeadingAccounting {
  readonly anchor: ReferenceAnchor;
  readonly disposition: ReferenceHeadingDisposition;
}

export interface ReferenceProtectedRange {
  readonly end_byte: number;
  readonly kind:
    | "code"
    | "formula"
    | "html"
    | "link_destination"
    | "path"
    | "command"
    | "technical_token";
  readonly sha256: string;
  readonly start_byte: number;
}

export type ReferenceDiagnosticLocation =
  | { readonly entry_key: string; readonly kind: "entry" }
  | { readonly anchor: ReferenceAnchor; readonly kind: "heading" }
  | { readonly kind: "region"; readonly region_key: string }
  | { readonly kind: "page"; readonly page_index: number }
  | {
      readonly end_byte: number;
      readonly kind: "range";
      readonly start_byte: number;
    };

export interface ReferenceExpectedDiagnostic {
  readonly code: string;
  readonly location: ReferenceDiagnosticLocation;
  readonly phase:
    | "selection"
    | "contents"
    | "matching"
    | "structure"
    | "splitting"
    | "typography"
    | "ocr";
  readonly recovery: readonly (
    "select_structure" | "enable_region" | "reload" | "reprocess_verbatim"
  )[];
  readonly severity: "error" | "warning" | "info";
}

export interface MineruReferenceV2 {
  readonly archive_sha256: string;
  readonly expected_diagnostics: readonly ReferenceExpectedDiagnostic[];
  readonly fixture_id: string;
  readonly main_markdown: {
    readonly input_sha256: string;
    readonly relative_path: string;
  };
  readonly original_pdf: {
    readonly page_count: number;
    readonly relative_path: string;
    readonly sha256: string;
  };
  readonly printed_contents: {
    readonly regions: readonly ReferenceContentsRegion[];
    readonly state: "present" | "absent";
  };
  readonly protected_ranges: readonly ReferenceProtectedRange[];
  readonly raw_heading_accounting: readonly ReferenceHeadingAccounting[];
  readonly schema_version: 2;
}

const sha256Pattern = /^[a-f0-9]{64}$/u;
const fixtureIdPattern = /^real-mineru-[a-z0-9]{6,32}$/u;
const localKeyPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const diagnosticCodePattern = /^[A-Z][A-Z0-9_]{2,79}$/u;

function object(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  input: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(input).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} contains missing or unexpected fields`);
  }
}

function enumeration<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Values[number];
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`${label} must be a safe integer >= ${minimum}`);
  }
  return Number(value);
}

function boundedString(
  value: unknown,
  label: string,
  maximum: number,
  minimum = 1,
): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    value.includes("\0")
  ) {
    throw new Error(
      `${label} must contain ${minimum} to ${maximum} characters`,
    );
  }
  return value;
}

function hash(value: unknown, label: string): string {
  if (typeof value !== "string" || !sha256Pattern.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256`);
  }
  return value;
}

function relativePath(value: unknown, label: string): string {
  const path = boundedString(value, label, 2_000);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path
      .split("/")
      .some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a normalized relative path`);
  }
  return path;
}

function localKey(value: unknown, label: string): string {
  const key = boundedString(value, label, 120);
  if (!localKeyPattern.test(key)) throw new Error(`${label} is invalid`);
  return key;
}

function parseAnchor(value: unknown, label: string): ReferenceAnchor {
  const input = object(value, label);
  exactKeys(input, ["root_index", "sha256"], label);
  return Object.freeze({
    root_index: integer(input.root_index, `${label}.root_index`),
    sha256: hash(input.sha256, `${label}.sha256`),
  });
}

function anchorKey(anchor: ReferenceAnchor): string {
  return `${anchor.root_index}:${anchor.sha256}`;
}

function parseEntry(value: unknown, label: string): ReferenceContentsEntry {
  const input = object(value, label);
  exactKeys(
    input,
    [
      "body_heading_anchor",
      "entry_key",
      "expected_match",
      "kind",
      "level",
      "page_label",
      "title",
    ],
    label,
  );
  const expectedMatch = enumeration(
    input.expected_match,
    ["matched", "ambiguous", "unmatched"] as const,
    `${label}.expected_match`,
  );
  const bodyAnchor =
    input.body_heading_anchor === null
      ? null
      : parseAnchor(input.body_heading_anchor, `${label}.body_heading_anchor`);
  if (expectedMatch === "matched" && !bodyAnchor) {
    throw new Error(`${label} matched entries require a body heading anchor`);
  }
  if (expectedMatch !== "matched" && bodyAnchor) {
    throw new Error(
      `${label} unresolved entries cannot bind a body heading anchor`,
    );
  }
  const level = integer(input.level, `${label}.level`, 1);
  if (level > 4) throw new Error(`${label}.level must be from 1 to 4`);
  return Object.freeze({
    body_heading_anchor: bodyAnchor,
    entry_key: localKey(input.entry_key, `${label}.entry_key`),
    expected_match: expectedMatch,
    kind: enumeration(
      input.kind,
      [
        "part",
        "chapter",
        "section",
        "appendix",
        "frontmatter",
        "backmatter",
        "other",
      ] as const,
      `${label}.kind`,
    ),
    level,
    page_label:
      input.page_label === null
        ? null
        : boundedString(input.page_label, `${label}.page_label`, 32),
    title: boundedString(input.title, `${label}.title`, 500),
  });
}

function parseRegion(
  value: unknown,
  index: number,
  pageCount: number,
): ReferenceContentsRegion {
  const label = `reference.printed_contents.regions[${index}]`;
  const input = object(value, label);
  exactKeys(
    input,
    [
      "canonical",
      "entries",
      "markdown_range",
      "pdf_page_indices",
      "region_key",
    ],
    label,
  );
  if (typeof input.canonical !== "boolean") {
    throw new Error(`${label}.canonical must be boolean`);
  }
  if (
    !Array.isArray(input.pdf_page_indices) ||
    input.pdf_page_indices.length < 1 ||
    input.pdf_page_indices.length > 100
  ) {
    throw new Error(`${label}.pdf_page_indices must contain 1 to 100 pages`);
  }
  const pages = input.pdf_page_indices.map((page, pageIndex) =>
    integer(page, `${label}.pdf_page_indices[${pageIndex}]`),
  );
  if (
    new Set(pages).size !== pages.length ||
    pages.some(
      (page, pageIndex) =>
        pageIndex > 0 && page <= (pages[pageIndex - 1] ?? -1),
    )
  ) {
    throw new Error(`${label}.pdf_page_indices must be unique and ordered`);
  }
  if (pages.some((page) => page >= pageCount)) {
    throw new Error(
      `${label}.pdf_page_indices contains a page outside the PDF`,
    );
  }
  const rangeInput = object(input.markdown_range, `${label}.markdown_range`);
  exactKeys(rangeInput, ["end", "start"], `${label}.markdown_range`);
  const start = parseAnchor(rangeInput.start, `${label}.markdown_range.start`);
  const end = parseAnchor(rangeInput.end, `${label}.markdown_range.end`);
  if (end.root_index < start.root_index) {
    throw new Error(`${label}.markdown_range is reversed`);
  }
  if (
    !Array.isArray(input.entries) ||
    input.entries.length < 1 ||
    input.entries.length > 20_000
  ) {
    throw new Error(`${label}.entries must contain 1 to 20000 entries`);
  }
  const entries = input.entries.map((entry, entryIndex) =>
    parseEntry(entry, `${label}.entries[${entryIndex}]`),
  );
  if (
    new Set(entries.map((entry) => entry.entry_key)).size !== entries.length
  ) {
    throw new Error(`${label}.entry_key values must be unique within a region`);
  }
  return Object.freeze({
    canonical: input.canonical,
    entries: Object.freeze(entries),
    markdown_range: Object.freeze({ end, start }),
    pdf_page_indices: Object.freeze(pages),
    region_key: localKey(input.region_key, `${label}.region_key`),
  });
}

function parseHeadingAccounting(
  value: unknown,
  index: number,
): ReferenceHeadingAccounting {
  const label = `reference.raw_heading_accounting[${index}]`;
  const input = object(value, label);
  exactKeys(input, ["anchor", "disposition"], label);
  const dispositionInput = object(input.disposition, `${label}.disposition`);
  const kind = enumeration(
    dispositionInput.kind,
    ["excluded", "expected_body"] as const,
    `${label}.disposition.kind`,
  );
  let disposition: ReferenceHeadingDisposition;
  if (kind === "excluded") {
    exactKeys(dispositionInput, ["kind", "region_key"], `${label}.disposition`);
    disposition = Object.freeze({
      kind,
      region_key: localKey(
        dispositionInput.region_key,
        `${label}.disposition.region_key`,
      ),
    });
  } else {
    exactKeys(
      dispositionInput,
      [
        "display_level",
        "display_title",
        "include_in_toc",
        "kind",
        "role",
        "starts_page",
      ],
      `${label}.disposition`,
    );
    const level = integer(
      dispositionInput.display_level,
      `${label}.disposition.display_level`,
      1,
    );
    if (level > 4) {
      throw new Error(`${label}.disposition.display_level must be from 1 to 4`);
    }
    if (
      typeof dispositionInput.include_in_toc !== "boolean" ||
      typeof dispositionInput.starts_page !== "boolean"
    ) {
      throw new Error(
        `${label}.disposition TOC and split values must be boolean`,
      );
    }
    disposition = Object.freeze({
      display_level: level,
      display_title:
        dispositionInput.display_title === null
          ? null
          : boundedString(
              dispositionInput.display_title,
              `${label}.disposition.display_title`,
              500,
            ),
      include_in_toc: dispositionInput.include_in_toc,
      kind,
      role: enumeration(
        dispositionInput.role,
        ["frontmatter", "body", "appendix", "backmatter"] as const,
        `${label}.disposition.role`,
      ),
      starts_page: dispositionInput.starts_page,
    });
  }
  return Object.freeze({
    anchor: parseAnchor(input.anchor, `${label}.anchor`),
    disposition,
  });
}

function parseProtectedRange(
  value: unknown,
  index: number,
): ReferenceProtectedRange {
  const label = `reference.protected_ranges[${index}]`;
  const input = object(value, label);
  exactKeys(input, ["end_byte", "kind", "sha256", "start_byte"], label);
  const startByte = integer(input.start_byte, `${label}.start_byte`);
  const endByte = integer(input.end_byte, `${label}.end_byte`);
  if (endByte <= startByte) throw new Error(`${label} range must not be empty`);
  return Object.freeze({
    end_byte: endByte,
    kind: enumeration(
      input.kind,
      [
        "code",
        "formula",
        "html",
        "link_destination",
        "path",
        "command",
        "technical_token",
      ] as const,
      `${label}.kind`,
    ),
    sha256: hash(input.sha256, `${label}.sha256`),
    start_byte: startByte,
  });
}

function parseDiagnosticLocation(
  value: unknown,
  label: string,
): ReferenceDiagnosticLocation {
  const input = object(value, label);
  const kind = enumeration(
    input.kind,
    ["entry", "heading", "region", "page", "range"] as const,
    `${label}.kind`,
  );
  if (kind === "entry") {
    exactKeys(input, ["entry_key", "kind"], label);
    return Object.freeze({
      entry_key: localKey(input.entry_key, `${label}.entry_key`),
      kind,
    });
  }
  if (kind === "heading") {
    exactKeys(input, ["anchor", "kind"], label);
    return Object.freeze({
      anchor: parseAnchor(input.anchor, `${label}.anchor`),
      kind,
    });
  }
  if (kind === "region") {
    exactKeys(input, ["kind", "region_key"], label);
    return Object.freeze({
      kind,
      region_key: localKey(input.region_key, `${label}.region_key`),
    });
  }
  if (kind === "page") {
    exactKeys(input, ["kind", "page_index"], label);
    return Object.freeze({
      kind,
      page_index: integer(input.page_index, `${label}.page_index`),
    });
  }
  exactKeys(input, ["end_byte", "kind", "start_byte"], label);
  const startByte = integer(input.start_byte, `${label}.start_byte`);
  const endByte = integer(input.end_byte, `${label}.end_byte`);
  if (endByte <= startByte) throw new Error(`${label} range must not be empty`);
  return Object.freeze({ end_byte: endByte, kind, start_byte: startByte });
}

function parseDiagnostic(
  value: unknown,
  index: number,
): ReferenceExpectedDiagnostic {
  const label = `reference.expected_diagnostics[${index}]`;
  const input = object(value, label);
  exactKeys(
    input,
    ["code", "location", "phase", "recovery", "severity"],
    label,
  );
  const code = boundedString(input.code, `${label}.code`, 80);
  if (!diagnosticCodePattern.test(code)) {
    throw new Error(`${label}.code is invalid`);
  }
  if (!Array.isArray(input.recovery) || input.recovery.length > 4) {
    throw new Error(
      `${label}.recovery must be an array of at most four actions`,
    );
  }
  const recovery = input.recovery.map((action, actionIndex) =>
    enumeration(
      action,
      [
        "select_structure",
        "enable_region",
        "reload",
        "reprocess_verbatim",
      ] as const,
      `${label}.recovery[${actionIndex}]`,
    ),
  );
  const severity = enumeration(
    input.severity,
    ["error", "warning", "info"] as const,
    `${label}.severity`,
  );
  if (severity !== "info" && recovery.length === 0) {
    throw new Error(`${label}.recovery is required for warnings and errors`);
  }
  if (new Set(recovery).size !== recovery.length) {
    throw new Error(`${label}.recovery actions must be unique`);
  }
  return Object.freeze({
    code,
    location: parseDiagnosticLocation(input.location, `${label}.location`),
    phase: enumeration(
      input.phase,
      [
        "selection",
        "contents",
        "matching",
        "structure",
        "splitting",
        "typography",
        "ocr",
      ] as const,
      `${label}.phase`,
    ),
    recovery: Object.freeze(recovery),
    severity,
  });
}

export function parseMineruReferenceV2(value: unknown): MineruReferenceV2 {
  const input = object(value, "reference");
  exactKeys(
    input,
    [
      "archive_sha256",
      "expected_diagnostics",
      "fixture_id",
      "main_markdown",
      "original_pdf",
      "printed_contents",
      "protected_ranges",
      "raw_heading_accounting",
      "schema_version",
    ],
    "reference",
  );
  if (input.schema_version !== 2) {
    throw new Error("reference.schema_version must be 2");
  }
  if (
    typeof input.fixture_id !== "string" ||
    !fixtureIdPattern.test(input.fixture_id)
  ) {
    throw new Error("reference.fixture_id is invalid");
  }

  const pdfInput = object(input.original_pdf, "reference.original_pdf");
  exactKeys(
    pdfInput,
    ["page_count", "relative_path", "sha256"],
    "reference.original_pdf",
  );
  const pageCount = integer(
    pdfInput.page_count,
    "reference.original_pdf.page_count",
    1,
  );
  const originalPdf = Object.freeze({
    page_count: pageCount,
    relative_path: relativePath(
      pdfInput.relative_path,
      "reference.original_pdf.relative_path",
    ),
    sha256: hash(pdfInput.sha256, "reference.original_pdf.sha256"),
  });

  const markdownInput = object(input.main_markdown, "reference.main_markdown");
  exactKeys(
    markdownInput,
    ["input_sha256", "relative_path"],
    "reference.main_markdown",
  );
  const mainMarkdown = Object.freeze({
    input_sha256: hash(
      markdownInput.input_sha256,
      "reference.main_markdown.input_sha256",
    ),
    relative_path: relativePath(
      markdownInput.relative_path,
      "reference.main_markdown.relative_path",
    ),
  });

  const contentsInput = object(
    input.printed_contents,
    "reference.printed_contents",
  );
  exactKeys(contentsInput, ["regions", "state"], "reference.printed_contents");
  const state = enumeration(
    contentsInput.state,
    ["present", "absent"] as const,
    "reference.printed_contents.state",
  );
  if (
    !Array.isArray(contentsInput.regions) ||
    contentsInput.regions.length > 20
  ) {
    throw new Error("reference.printed_contents.regions is invalid");
  }
  const regions = contentsInput.regions.map((region, index) =>
    parseRegion(region, index, pageCount),
  );
  if (state === "absent" && regions.length > 0) {
    throw new Error("reference absent contents cannot have regions");
  }
  if (
    state === "present" &&
    (regions.length === 0 ||
      regions.filter((region) => region.canonical).length !== 1)
  ) {
    throw new Error(
      "reference present contents require exactly one canonical region",
    );
  }
  if (
    new Set(regions.map((region) => region.region_key)).size !== regions.length
  ) {
    throw new Error("reference region keys must be unique");
  }
  const sortedRegions = [...regions].sort(
    (left, right) =>
      left.markdown_range.start.root_index -
      right.markdown_range.start.root_index,
  );
  for (let index = 1; index < sortedRegions.length; index += 1) {
    const previous = sortedRegions[index - 1];
    const current = sortedRegions[index];
    if (
      previous &&
      current &&
      current.markdown_range.start.root_index <=
        previous.markdown_range.end.root_index
    ) {
      throw new Error("reference printed contents regions must not overlap");
    }
  }

  if (
    !Array.isArray(input.raw_heading_accounting) ||
    input.raw_heading_accounting.length > 30_000
  ) {
    throw new Error("reference.raw_heading_accounting is invalid");
  }
  const accounting = input.raw_heading_accounting.map(parseHeadingAccounting);
  if (
    new Set(accounting.map((heading) => anchorKey(heading.anchor))).size !==
    accounting.length
  ) {
    throw new Error("reference heading anchors must be unique");
  }
  const regionByKey = new Map(
    regions.map((region) => [region.region_key, region] as const),
  );
  const bodyAnchors = new Set(
    accounting
      .filter(
        (
          heading,
        ): heading is ReferenceHeadingAccounting & {
          readonly disposition: Extract<
            ReferenceHeadingDisposition,
            { readonly kind: "expected_body" }
          >;
        } => heading.disposition.kind === "expected_body",
      )
      .map((heading) => anchorKey(heading.anchor)),
  );
  for (const heading of accounting) {
    if (heading.disposition.kind !== "excluded") continue;
    const region = regionByKey.get(heading.disposition.region_key);
    if (!region)
      throw new Error("reference heading uses an unknown excluded region");
    if (
      heading.anchor.root_index < region.markdown_range.start.root_index ||
      heading.anchor.root_index > region.markdown_range.end.root_index
    ) {
      throw new Error("reference excluded heading is outside its region");
    }
  }
  const allEntryKeys = new Set<string>();
  for (const region of regions) {
    for (const entry of region.entries) {
      if (allEntryKeys.has(entry.entry_key)) {
        throw new Error("reference entry keys must be unique across regions");
      }
      allEntryKeys.add(entry.entry_key);
      if (
        entry.body_heading_anchor &&
        !bodyAnchors.has(anchorKey(entry.body_heading_anchor))
      ) {
        throw new Error(
          "reference matched entry points to an unaccounted body heading",
        );
      }
    }
  }

  if (
    !Array.isArray(input.protected_ranges) ||
    input.protected_ranges.length > 20_000
  ) {
    throw new Error("reference.protected_ranges is invalid");
  }
  const protectedRanges = input.protected_ranges.map(parseProtectedRange);
  const orderedRanges = [...protectedRanges].sort(
    (left, right) => left.start_byte - right.start_byte,
  );
  for (let index = 1; index < orderedRanges.length; index += 1) {
    const previous = orderedRanges[index - 1];
    const current = orderedRanges[index];
    if (previous && current && current.start_byte < previous.end_byte) {
      throw new Error("reference protected ranges must not overlap");
    }
  }

  if (
    !Array.isArray(input.expected_diagnostics) ||
    input.expected_diagnostics.length > 5_000
  ) {
    throw new Error("reference.expected_diagnostics is invalid");
  }
  const diagnostics = input.expected_diagnostics.map(parseDiagnostic);
  for (const diagnostic of diagnostics) {
    const location = diagnostic.location;
    if (location.kind === "entry" && !allEntryKeys.has(location.entry_key)) {
      throw new Error("reference diagnostic uses an unknown entry key");
    }
    if (location.kind === "region" && !regionByKey.has(location.region_key)) {
      throw new Error("reference diagnostic uses an unknown region key");
    }
    if (
      location.kind === "heading" &&
      !accounting.some(
        (item) => anchorKey(item.anchor) === anchorKey(location.anchor),
      )
    ) {
      throw new Error("reference diagnostic uses an unknown heading anchor");
    }
    if (location.kind === "page" && location.page_index >= pageCount) {
      throw new Error("reference diagnostic page is outside the PDF");
    }
  }

  return Object.freeze({
    archive_sha256: hash(input.archive_sha256, "reference.archive_sha256"),
    expected_diagnostics: Object.freeze(diagnostics),
    fixture_id: input.fixture_id,
    main_markdown: mainMarkdown,
    original_pdf: originalPdf,
    printed_contents: Object.freeze({
      regions: Object.freeze(regions),
      state,
    }),
    protected_ranges: Object.freeze(protectedRanges),
    raw_heading_accounting: Object.freeze(accounting),
    schema_version: 2,
  });
}

export async function readMineruReferenceV2(
  path: string,
): Promise<MineruReferenceV2> {
  const source = await readFile(path, "utf8");
  if (Buffer.byteLength(source) > 16 * 1024 * 1024) {
    throw new Error("reference file exceeds 16 MiB");
  }
  return parseMineruReferenceV2(JSON.parse(source) as unknown);
}
