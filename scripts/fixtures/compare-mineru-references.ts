import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  readMineruReferenceV2,
  type MineruReferenceV2,
  type ReferenceAnchor,
  type ReferenceContentsRegion,
  type ReferenceExpectedDiagnostic,
  type ReferenceHeadingAccounting,
  type ReferenceProtectedRange,
} from "./mineru-reference-v2.js";

export interface ObservedProtectedRange extends ReferenceProtectedRange {
  readonly output_sha256: string;
}

export interface ObservedMineruOutcome {
  readonly archive_sha256: string;
  readonly diagnostics: readonly ReferenceExpectedDiagnostic[];
  readonly fixture_id: string;
  readonly main_markdown: MineruReferenceV2["main_markdown"];
  readonly original_pdf: MineruReferenceV2["original_pdf"];
  readonly printed_contents: MineruReferenceV2["printed_contents"];
  readonly protected_ranges: readonly ObservedProtectedRange[];
  readonly raw_heading_accounting: readonly ReferenceHeadingAccounting[];
}

export interface ReferenceComparisonIssue {
  readonly code: string;
  readonly path: string;
}

export interface ReferenceComparison {
  readonly fixture_id: string;
  readonly issues: readonly ReferenceComparisonIssue[];
  readonly ok: boolean;
}

function anchorKey(anchor: ReferenceAnchor): string {
  return `${anchor.root_index}:${anchor.sha256}`;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diagnosticKey(diagnostic: ReferenceExpectedDiagnostic): string {
  return `${diagnostic.code}:${JSON.stringify(diagnostic.location)}`;
}

function compareRegion(
  expected: ReferenceContentsRegion,
  actual: ReferenceContentsRegion,
  add: (code: string, path: string) => void,
): void {
  const path = `regions/${expected.region_key}`;
  if (expected.canonical !== actual.canonical) {
    add("REGION_CANONICAL_MISMATCH", path);
  }
  if (!same(expected.pdf_page_indices, actual.pdf_page_indices)) {
    add("REGION_PDF_PAGES_MISMATCH", path);
  }
  if (!same(expected.markdown_range, actual.markdown_range)) {
    add("REGION_MARKDOWN_RANGE_MISMATCH", path);
  }
  const expectedKeys = expected.entries.map((entry) => entry.entry_key);
  const actualKeys = actual.entries.map((entry) => entry.entry_key);
  if (!same(expectedKeys, actualKeys)) add("ENTRY_ORDER_MISMATCH", path);
  const actualByKey = new Map(
    actual.entries.map((entry) => [entry.entry_key, entry] as const),
  );
  const expectedByKey = new Map(
    expected.entries.map((entry) => [entry.entry_key, entry] as const),
  );
  for (const entry of expected.entries) {
    const observed = actualByKey.get(entry.entry_key);
    const entryPath = `${path}/entries/${entry.entry_key}`;
    if (!observed) {
      add("ENTRY_MISSING", entryPath);
      continue;
    }
    if (entry.title !== observed.title) add("ENTRY_TITLE_MISMATCH", entryPath);
    if (entry.kind !== observed.kind) add("ENTRY_KIND_MISMATCH", entryPath);
    if (entry.level !== observed.level) add("ENTRY_LEVEL_MISMATCH", entryPath);
    if (entry.page_label !== observed.page_label) {
      add("ENTRY_PAGE_LABEL_MISMATCH", entryPath);
    }
    if (entry.expected_match !== observed.expected_match) {
      add("ENTRY_MATCH_MISMATCH", entryPath);
    }
    if (!same(entry.body_heading_anchor, observed.body_heading_anchor)) {
      add("ENTRY_BODY_MISMATCH", entryPath);
    }
  }
  for (const entry of actual.entries) {
    if (!expectedByKey.has(entry.entry_key)) {
      add("ENTRY_EXTRA", `${path}/entries/${entry.entry_key}`);
    }
  }
}

function compareHeading(
  expected: ReferenceHeadingAccounting,
  actual: ReferenceHeadingAccounting,
  add: (code: string, path: string) => void,
): void {
  const path = `headings/${expected.anchor.root_index}`;
  if (expected.disposition.kind !== actual.disposition.kind) {
    add("HEADING_DISPOSITION_MISMATCH", path);
    return;
  }
  if (expected.disposition.kind === "excluded") {
    if (
      actual.disposition.kind !== "excluded" ||
      expected.disposition.region_key !== actual.disposition.region_key
    ) {
      add("HEADING_EXCLUDED_REGION_MISMATCH", path);
    }
    return;
  }
  if (actual.disposition.kind !== "expected_body") return;
  if (expected.disposition.display_level !== actual.disposition.display_level) {
    add("HEADING_LEVEL_MISMATCH", path);
  }
  if (expected.disposition.display_title !== actual.disposition.display_title) {
    add("HEADING_DISPLAY_TITLE_MISMATCH", path);
  }
  if (
    expected.disposition.include_in_toc !== actual.disposition.include_in_toc
  ) {
    add("HEADING_TOC_MISMATCH", path);
  }
  if (expected.disposition.role !== actual.disposition.role) {
    add("HEADING_ROLE_MISMATCH", path);
  }
  if (expected.disposition.starts_page !== actual.disposition.starts_page) {
    add("HEADING_SPLIT_MISMATCH", path);
  }
}

export function compareMineruReferenceV2(
  expected: MineruReferenceV2,
  actual: ObservedMineruOutcome,
): ReferenceComparison {
  const issues: ReferenceComparisonIssue[] = [];
  const add = (code: string, path: string) => {
    issues.push(Object.freeze({ code, path }));
  };
  if (expected.fixture_id !== actual.fixture_id) {
    add("FIXTURE_ID_MISMATCH", "fixture");
  }
  if (expected.archive_sha256 !== actual.archive_sha256) {
    add("ARCHIVE_HASH_MISMATCH", "archive");
  }
  if (
    expected.main_markdown.relative_path !== actual.main_markdown.relative_path
  ) {
    add("MAIN_MARKDOWN_PATH_MISMATCH", "main_markdown");
  }
  if (
    expected.main_markdown.input_sha256 !== actual.main_markdown.input_sha256
  ) {
    add("MAIN_MARKDOWN_HASH_MISMATCH", "main_markdown");
  }
  if (
    expected.original_pdf.relative_path !== actual.original_pdf.relative_path
  ) {
    add("ORIGINAL_PDF_PATH_MISMATCH", "original_pdf");
  }
  if (expected.original_pdf.sha256 !== actual.original_pdf.sha256) {
    add("ORIGINAL_PDF_HASH_MISMATCH", "original_pdf");
  }
  if (expected.original_pdf.page_count !== actual.original_pdf.page_count) {
    add("ORIGINAL_PDF_PAGE_COUNT_MISMATCH", "original_pdf");
  }
  if (expected.printed_contents.state !== actual.printed_contents.state) {
    add("PRINTED_CONTENTS_STATE_MISMATCH", "printed_contents");
  }

  const expectedRegionKeys = expected.printed_contents.regions.map(
    (region) => region.region_key,
  );
  const actualRegionKeys = actual.printed_contents.regions.map(
    (region) => region.region_key,
  );
  if (!same(expectedRegionKeys, actualRegionKeys)) {
    add("REGION_ORDER_MISMATCH", "printed_contents");
  }
  const actualRegions = new Map(
    actual.printed_contents.regions.map(
      (region) => [region.region_key, region] as const,
    ),
  );
  const expectedRegions = new Map(
    expected.printed_contents.regions.map(
      (region) => [region.region_key, region] as const,
    ),
  );
  for (const region of expected.printed_contents.regions) {
    const observed = actualRegions.get(region.region_key);
    if (!observed) {
      add("REGION_MISSING", `regions/${region.region_key}`);
      continue;
    }
    compareRegion(region, observed, add);
  }
  for (const region of actual.printed_contents.regions) {
    if (!expectedRegions.has(region.region_key)) {
      add("REGION_EXTRA", `regions/${region.region_key}`);
    }
  }

  const expectedHeadingKeys = expected.raw_heading_accounting.map((heading) =>
    anchorKey(heading.anchor),
  );
  const actualHeadingKeys = actual.raw_heading_accounting.map((heading) =>
    anchorKey(heading.anchor),
  );
  if (!same(expectedHeadingKeys, actualHeadingKeys)) {
    add("HEADING_ORDER_MISMATCH", "headings");
  }
  const actualHeadings = new Map(
    actual.raw_heading_accounting.map(
      (heading) => [anchorKey(heading.anchor), heading] as const,
    ),
  );
  const expectedHeadings = new Set(expectedHeadingKeys);
  for (const heading of expected.raw_heading_accounting) {
    const observed = actualHeadings.get(anchorKey(heading.anchor));
    if (!observed) {
      add("HEADING_MISSING", `headings/${heading.anchor.root_index}`);
      continue;
    }
    compareHeading(heading, observed, add);
  }
  for (const heading of actual.raw_heading_accounting) {
    if (!expectedHeadings.has(anchorKey(heading.anchor))) {
      add("HEADING_EXTRA", `headings/${heading.anchor.root_index}`);
    }
  }

  const protectedKey = (range: ReferenceProtectedRange) =>
    `${range.start_byte}:${range.end_byte}:${range.kind}`;
  const actualRanges = new Map(
    actual.protected_ranges.map(
      (range) => [protectedKey(range), range] as const,
    ),
  );
  const expectedRangeKeys = new Set(
    expected.protected_ranges.map(protectedKey),
  );
  for (const range of expected.protected_ranges) {
    const key = protectedKey(range);
    const observed = actualRanges.get(key);
    if (!observed) {
      add("PROTECTED_RANGE_MISSING", `protected_ranges/${key}`);
      continue;
    }
    if (range.sha256 !== observed.sha256) {
      add("PROTECTED_RANGE_INPUT_MISMATCH", `protected_ranges/${key}`);
    }
    if (range.sha256 !== observed.output_sha256) {
      add("PROTECTED_RANGE_CHANGED", `protected_ranges/${key}`);
    }
  }
  for (const range of actual.protected_ranges) {
    const key = protectedKey(range);
    if (!expectedRangeKeys.has(key)) {
      add("PROTECTED_RANGE_EXTRA", `protected_ranges/${key}`);
    }
  }

  const expectedDiagnostics = new Map(
    expected.expected_diagnostics.map(
      (diagnostic) => [diagnosticKey(diagnostic), diagnostic] as const,
    ),
  );
  const actualDiagnostics = new Map(
    actual.diagnostics.map(
      (diagnostic) => [diagnosticKey(diagnostic), diagnostic] as const,
    ),
  );
  for (const [key, diagnostic] of expectedDiagnostics) {
    const observed = actualDiagnostics.get(key);
    if (!observed) {
      add("DIAGNOSTIC_MISSING", `diagnostics/${diagnostic.code}`);
    } else if (!same(diagnostic, observed)) {
      add("DIAGNOSTIC_DETAIL_MISMATCH", `diagnostics/${diagnostic.code}`);
    }
  }
  for (const [key, diagnostic] of actualDiagnostics) {
    if (!expectedDiagnostics.has(key)) {
      add("DIAGNOSTIC_EXTRA", `diagnostics/${diagnostic.code}`);
    }
  }

  return Object.freeze({
    fixture_id: expected.fixture_id,
    issues: Object.freeze(issues),
    ok: issues.length === 0,
  });
}

function argumentsMap(arguments_: readonly string[]): Map<string, string> {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const values = new Map<string, string>();
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    const value = normalized[index + 1];
    if (
      !name ||
      !["--observed-dir", "--output", "--reference-dir"].includes(name) ||
      !value ||
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
  const observedDirectory = values.get("--observed-dir");
  const output = values.get("--output");
  const referenceDirectory = values.get("--reference-dir");
  if (!observedDirectory || !referenceDirectory) {
    throw new Error("Required: --reference-dir --observed-dir");
  }
  const references = resolve(referenceDirectory);
  const observed = resolve(observedDirectory);
  const files = (await readdir(references))
    .filter((name) => name.endsWith(".json") && basename(name) === name)
    .sort((left, right) => left.localeCompare(right, "en"));
  if (files.length !== 15) {
    throw new Error("REFERENCE_V2_SET_MUST_CONTAIN_FIFTEEN_FILES");
  }
  const comparisons: ReferenceComparison[] = [];
  for (const file of files) {
    const expected = await readMineruReferenceV2(join(references, file));
    const actual = JSON.parse(
      await readFile(join(observed, file), "utf8"),
    ) as ObservedMineruOutcome;
    comparisons.push(compareMineruReferenceV2(expected, actual));
  }
  const report = Object.freeze({
    comparisons: Object.freeze(comparisons),
    ok: comparisons.every((comparison) => comparison.ok),
    schema_version: 1,
  });
  if (output) {
    await writeFile(resolve(output), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
