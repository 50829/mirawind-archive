import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  readMineruReference,
  type MineruReference,
  type ReferenceAnchor,
  type ReferenceContentsRegion,
  type ReferenceContentsEntry,
  type ReferenceExpectedDiagnostic,
  type ReferenceHeadingAccounting,
  type ReferenceProtectedRange,
} from "./mineru-reference.js";

export interface ObservedProtectedRange extends ReferenceProtectedRange {
  readonly output_sha256: string;
}

export interface ObservedMineruOutcome {
  readonly archive_sha256: string;
  readonly diagnostics: readonly ReferenceExpectedDiagnostic[];
  readonly fixture_id: string;
  readonly main_markdown: MineruReference["main_markdown"];
  readonly original_pdf: MineruReference["original_pdf"];
  readonly printed_contents: MineruReference["printed_contents"];
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

export interface ReferenceComparisonReport {
  readonly comparisons: readonly ReferenceComparison[];
  readonly ok: boolean;
  readonly schema_version: 1;
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

function comparableTitle(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/u, "")
    .replace(/(?<!\\)\$/gu, "")
    .replace(/[\p{P}\p{S}\s]/gu, "")
    .toLocaleLowerCase("und");
}

interface TitleProfile {
  readonly pairs: ReadonlyMap<string, number>;
  readonly value: string;
}

function titleProfile(value: string): TitleProfile {
  const normalized = comparableTitle(value);
  const pairs = new Map<string, number>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    pairs.set(pair, (pairs.get(pair) ?? 0) + 1);
  }
  return Object.freeze({ pairs, value: normalized });
}

function titleSimilarity(left: TitleProfile, right: TitleProfile): number {
  if (left.value === right.value) return 1;
  if (left.value.length < 2 || right.value.length < 2) return 0;
  let overlap = 0;
  for (const [pair, count] of left.pairs) {
    overlap += Math.min(count, right.pairs.get(pair) ?? 0);
  }
  return (2 * overlap) / (left.value.length + right.value.length - 2);
}

function entryAlignmentScore(
  expected: ReferenceContentsEntry,
  actual: ReferenceContentsEntry,
  expectedTitle: TitleProfile,
  actualTitle: TitleProfile,
): number | undefined {
  const sameAnchor =
    expected.body_heading_anchor !== null &&
    actual.body_heading_anchor !== null &&
    anchorKey(expected.body_heading_anchor) ===
      anchorKey(actual.body_heading_anchor);
  const similarity = sameAnchor
    ? 0
    : titleSimilarity(expectedTitle, actualTitle);
  if (!sameAnchor && similarity < 0.58) return;
  return (
    (sameAnchor ? 20 : similarity * 10) +
    (expected.page_label === actual.page_label ? 1 : 0) +
    (expected.kind === actual.kind ? 1 : 0) +
    (expected.level === actual.level ? 1 : 0)
  );
}

function alignEntries(
  expected: readonly ReferenceContentsEntry[],
  actual: readonly ReferenceContentsEntry[],
  expectedTitles: readonly TitleProfile[],
  actualTitles: readonly TitleProfile[],
): {
  readonly pairs: readonly {
    readonly actual: ReferenceContentsEntry;
    readonly actualIndex: number;
    readonly expected: ReferenceContentsEntry;
    readonly expectedIndex: number;
  }[];
  readonly unmatchedActual: ReadonlySet<number>;
  readonly unmatchedExpected: ReadonlySet<number>;
} {
  const width = actual.length + 1;
  const scores = new Float64Array((expected.length + 1) * width);
  const actions = new Uint8Array(scores.length);
  const skipCost = 3;
  for (
    let expectedIndex = 1;
    expectedIndex <= expected.length;
    expectedIndex += 1
  ) {
    scores[expectedIndex * width] = -skipCost * expectedIndex;
    actions[expectedIndex * width] = 1;
  }
  for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
    scores[actualIndex] = -skipCost * actualIndex;
    actions[actualIndex] = 2;
  }
  for (
    let expectedIndex = 1;
    expectedIndex <= expected.length;
    expectedIndex += 1
  ) {
    for (let actualIndex = 1; actualIndex <= actual.length; actualIndex += 1) {
      const offset = expectedIndex * width + actualIndex;
      const skipExpected =
        (scores[offset - width] ?? Number.NEGATIVE_INFINITY) - skipCost;
      const skipActual =
        (scores[offset - 1] ?? Number.NEGATIVE_INFINITY) - skipCost;
      const match = entryAlignmentScore(
        expected[expectedIndex - 1] as ReferenceContentsEntry,
        actual[actualIndex - 1] as ReferenceContentsEntry,
        expectedTitles[expectedIndex - 1] as TitleProfile,
        actualTitles[actualIndex - 1] as TitleProfile,
      );
      const matched =
        match === undefined
          ? Number.NEGATIVE_INFINITY
          : (scores[offset - width - 1] ?? Number.NEGATIVE_INFINITY) + match;
      if (matched >= skipExpected && matched >= skipActual) {
        scores[offset] = matched;
        actions[offset] = 3;
      } else if (skipExpected >= skipActual) {
        scores[offset] = skipExpected;
        actions[offset] = 1;
      } else {
        scores[offset] = skipActual;
        actions[offset] = 2;
      }
    }
  }
  const pairs = [];
  const unmatchedExpected = new Set<number>();
  const unmatchedActual = new Set<number>();
  let expectedIndex = expected.length;
  let actualIndex = actual.length;
  while (expectedIndex > 0 || actualIndex > 0) {
    const action = actions[expectedIndex * width + actualIndex];
    if (action === 3) {
      pairs.push(
        Object.freeze({
          actual: actual[actualIndex - 1] as ReferenceContentsEntry,
          actualIndex: actualIndex - 1,
          expected: expected[expectedIndex - 1] as ReferenceContentsEntry,
          expectedIndex: expectedIndex - 1,
        }),
      );
      expectedIndex -= 1;
      actualIndex -= 1;
    } else if (action === 1 && expectedIndex > 0) {
      unmatchedExpected.add(--expectedIndex);
    } else if (actualIndex > 0) {
      unmatchedActual.add(--actualIndex);
    } else {
      unmatchedExpected.add(--expectedIndex);
    }
  }
  return Object.freeze({
    pairs: Object.freeze(pairs.reverse()),
    unmatchedActual: Object.freeze(unmatchedActual),
    unmatchedExpected: Object.freeze(unmatchedExpected),
  });
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
  const expectedTitles = expected.entries.map((entry) =>
    titleProfile(entry.title),
  );
  const actualTitles = actual.entries.map((entry) => titleProfile(entry.title));
  const alignment = alignEntries(
    expected.entries,
    actual.entries,
    expectedTitles,
    actualTitles,
  );
  if (
    alignment.unmatchedExpected.size > 0 ||
    alignment.unmatchedActual.size > 0
  ) {
    add("ENTRY_ORDER_MISMATCH", path);
  }
  for (const {
    actual: observed,
    actualIndex,
    expected: entry,
    expectedIndex,
  } of alignment.pairs) {
    const entryPath = `${path}/entries/${entry.entry_key}`;
    const alignedTitleSimilarity = titleSimilarity(
      expectedTitles[expectedIndex] as TitleProfile,
      actualTitles[actualIndex] as TitleProfile,
    );
    if (alignedTitleSimilarity < 0.9) {
      add("ENTRY_TITLE_MISMATCH", entryPath);
    }
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
  for (const expectedIndex of alignment.unmatchedExpected) {
    const entry = expected.entries[expectedIndex];
    if (entry) add("ENTRY_MISSING", `${path}/entries/${entry.entry_key}`);
  }
  for (const actualIndex of alignment.unmatchedActual) {
    const entry = actual.entries[actualIndex];
    if (entry) add("ENTRY_EXTRA", `${path}/entries/${entry.entry_key}`);
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

export function compareMineruReference(
  expected: MineruReference,
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

const fixtureIdPattern = /^real-mineru-[a-z0-9]{6,32}$/u;

function selectedFixtureIds(fixtureIds: readonly string[]): readonly string[] {
  if (fixtureIds.length < 1) throw new Error("REFERENCE_V2_SUBSET_EMPTY");
  if (
    fixtureIds.some((fixtureId) => !fixtureIdPattern.test(fixtureId)) ||
    new Set(fixtureIds).size !== fixtureIds.length
  ) {
    throw new Error("REFERENCE_V2_SUBSET_INVALID");
  }
  return Object.freeze(
    fixtureIds.toSorted((left, right) => left.localeCompare(right, "en")),
  );
}

export async function compareMineruReferenceSet(input: {
  readonly fixtureIds?: readonly string[];
  readonly observedDirectory: string;
  readonly referenceDirectory: string;
}): Promise<ReferenceComparisonReport> {
  const references = resolve(input.referenceDirectory);
  const observed = resolve(input.observedDirectory);
  const files = input.fixtureIds
    ? selectedFixtureIds(input.fixtureIds).map(
        (fixtureId) => `${fixtureId}.json`,
      )
    : (await readdir(references))
        .filter((name) => name.endsWith(".json") && basename(name) === name)
        .sort((left, right) => left.localeCompare(right, "en"));
  if (!input.fixtureIds && files.length !== 15) {
    throw new Error("REFERENCE_V2_SET_MUST_CONTAIN_FIFTEEN_FILES");
  }
  const comparisons: ReferenceComparison[] = [];
  for (const file of files) {
    const expected = await readMineruReference(join(references, file));
    if (`${expected.fixture_id}.json` !== file) {
      throw new Error("REFERENCE_V2_FILENAME_BINDING_MISMATCH");
    }
    const actual = JSON.parse(
      await readFile(join(observed, file), "utf8"),
    ) as ObservedMineruOutcome;
    comparisons.push(compareMineruReference(expected, actual));
  }
  return Object.freeze({
    comparisons: Object.freeze(comparisons),
    ok: comparisons.every((comparison) => comparison.ok),
    schema_version: 1 as const,
  });
}

function parseArguments(arguments_: readonly string[]): {
  readonly fixtureIds: readonly string[];
  readonly observedDirectory: string;
  readonly output?: string;
  readonly referenceDirectory: string;
} {
  const normalized = arguments_[0] === "--" ? arguments_.slice(1) : arguments_;
  const values = new Map<string, string>();
  const fixtureIds: string[] = [];
  for (let index = 0; index < normalized.length; index += 2) {
    const name = normalized[index];
    const value = normalized[index + 1];
    if (
      !name ||
      !["--fixture", "--observed-dir", "--output", "--reference-dir"].includes(
        name,
      ) ||
      !value ||
      (name !== "--fixture" && values.has(name))
    ) {
      throw new Error("Arguments must be --name value pairs");
    }
    if (name === "--fixture") fixtureIds.push(value);
    else values.set(name, value);
  }
  const observedDirectory = values.get("--observed-dir");
  const output = values.get("--output");
  const referenceDirectory = values.get("--reference-dir");
  if (!observedDirectory || !referenceDirectory) {
    throw new Error("Required: --reference-dir --observed-dir");
  }
  return Object.freeze({
    fixtureIds: Object.freeze(fixtureIds),
    observedDirectory,
    ...(output ? { output } : {}),
    referenceDirectory,
  });
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const report = await compareMineruReferenceSet({
    ...(arguments_.fixtureIds.length > 0
      ? { fixtureIds: arguments_.fixtureIds }
      : {}),
    observedDirectory: arguments_.observedDirectory,
    referenceDirectory: arguments_.referenceDirectory,
  });
  if (arguments_.output) {
    await writeFile(
      resolve(arguments_.output),
      `${JSON.stringify(report, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
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
