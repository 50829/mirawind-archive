import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { compareMineruReferenceV2 } from "../../../scripts/fixtures/compare-mineru-references";
import {
  parseMineruReferenceV2,
  type MineruReferenceV2,
} from "../../../scripts/fixtures/mineru-reference-v2";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const anchor = (root_index: number, value: string) => ({
  root_index,
  sha256: hash(value),
});

function reference(): MineruReferenceV2 {
  return parseMineruReferenceV2({
    archive_sha256: hash("archive"),
    expected_diagnostics: [],
    fixture_id: "real-mineru-a7f31c",
    main_markdown: {
      input_sha256: hash("markdown"),
      relative_path: "bundle/full.md",
    },
    original_pdf: {
      page_count: 12,
      relative_path: "bundle/origin.pdf",
      sha256: hash("pdf"),
    },
    printed_contents: {
      regions: [
        {
          canonical: true,
          entries: [
            {
              body_heading_anchor: anchor(8, "chapter"),
              entry_key: "chapter-one",
              expected_match: "matched",
              kind: "chapter",
              level: 1,
              page_label: "1",
              title: "Chapter One",
            },
          ],
          markdown_range: {
            end: anchor(3, "toc end"),
            start: anchor(1, "toc start"),
          },
          pdf_page_indices: [2, 3],
          region_key: "full-contents",
        },
      ],
      state: "present",
    },
    protected_ranges: [
      {
        end_byte: 20,
        kind: "path",
        sha256: hash("path"),
        start_byte: 10,
      },
    ],
    raw_heading_accounting: [
      {
        anchor: anchor(1, "toc start"),
        disposition: { kind: "excluded", region_key: "full-contents" },
      },
      {
        anchor: anchor(8, "chapter"),
        disposition: {
          display_level: 1,
          display_title: null,
          include_in_toc: true,
          kind: "expected_body",
          role: "body",
          starts_page: true,
        },
      },
    ],
    schema_version: 2,
  });
}

function observed(expected = reference()) {
  return {
    archive_sha256: expected.archive_sha256,
    diagnostics: expected.expected_diagnostics,
    fixture_id: expected.fixture_id,
    main_markdown: expected.main_markdown,
    original_pdf: expected.original_pdf,
    printed_contents: expected.printed_contents,
    protected_ranges: expected.protected_ranges.map((range) => ({
      ...range,
      output_sha256: range.sha256,
    })),
    raw_heading_accounting: expected.raw_heading_accounting,
  };
}

describe("MinerU reference v2 comparator", () => {
  it("accepts an exact complete outcome", () => {
    expect(compareMineruReferenceV2(reference(), observed())).toEqual({
      fixture_id: "real-mineru-a7f31c",
      issues: [],
      ok: true,
    });
  });

  it("reports every structural surface without copying titles into issues", () => {
    const expected = reference();
    const actual = observed(expected);
    const region = actual.printed_contents.regions[0];
    const entry = region?.entries[0];
    const body = actual.raw_heading_accounting[1];
    const excluded = actual.raw_heading_accounting[0];
    const protectedRange = actual.protected_ranges[0];
    if (
      !region ||
      !entry ||
      !body ||
      !excluded ||
      !protectedRange ||
      body.disposition.kind !== "expected_body"
    ) {
      throw new Error("test fixture is incomplete");
    }
    const result = compareMineruReferenceV2(expected, {
      ...actual,
      main_markdown: {
        ...actual.main_markdown,
        relative_path: "bundle/wrong.md",
      },
      printed_contents: {
        ...actual.printed_contents,
        regions: [
          {
            ...region,
            canonical: false,
            entries: [
              {
                ...entry,
                body_heading_anchor: null,
                expected_match: "unmatched" as const,
                level: 2,
              },
            ],
          },
        ],
      },
      protected_ranges: [{ ...protectedRange, output_sha256: hash("changed") }],
      raw_heading_accounting: [
        excluded,
        {
          ...body,
          disposition: { ...body.disposition, starts_page: false },
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "MAIN_MARKDOWN_PATH_MISMATCH",
        "REGION_CANONICAL_MISMATCH",
        "ENTRY_MATCH_MISMATCH",
        "ENTRY_LEVEL_MISMATCH",
        "ENTRY_BODY_MISMATCH",
        "HEADING_SPLIT_MISMATCH",
        "PROTECTED_RANGE_CHANGED",
      ]),
    );
    expect(JSON.stringify(result.issues)).not.toContain("Chapter One");
  });

  it("reports missing, extra and reordered regions/headings/diagnostics", () => {
    const expected = reference();
    const actual = observed(expected);
    const result = compareMineruReferenceV2(expected, {
      ...actual,
      diagnostics: [
        {
          code: "EXTRA_DIAGNOSTIC",
          location: { kind: "page" as const, page_index: 0 },
          phase: "contents" as const,
          recovery: ["reload" as const],
          severity: "warning" as const,
        },
      ],
      printed_contents: { regions: [], state: "absent" as const },
      raw_heading_accounting: [
        ...actual.raw_heading_accounting.slice().reverse(),
        {
          anchor: anchor(11, "extra"),
          disposition: {
            display_level: 1,
            display_title: null,
            include_in_toc: true,
            kind: "expected_body" as const,
            role: "body" as const,
            starts_page: true,
          },
        },
      ],
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PRINTED_CONTENTS_STATE_MISMATCH",
        "REGION_MISSING",
        "HEADING_ORDER_MISMATCH",
        "HEADING_EXTRA",
        "DIAGNOSTIC_EXTRA",
      ]),
    );
  });

  it("keeps one missing entry local instead of shifting later comparisons", () => {
    const expected = reference();
    const first = expected.printed_contents.regions[0]?.entries[0];
    const region = expected.printed_contents.regions[0];
    if (!first || !region) throw new Error("test fixture is incomplete");
    const second = {
      ...first,
      body_heading_anchor: anchor(9, "second chapter"),
      entry_key: "chapter-two",
      page_label: "20",
      title: "Chapter Two",
    };
    const third = {
      ...first,
      body_heading_anchor: anchor(10, "third chapter"),
      entry_key: "chapter-three",
      page_label: "40",
      title: "Chapter Three",
    };
    const expanded = parseMineruReferenceV2({
      ...expected,
      printed_contents: {
        ...expected.printed_contents,
        regions: [{ ...region, entries: [first, second, third] }],
      },
      raw_heading_accounting: [
        ...expected.raw_heading_accounting,
        {
          anchor: second.body_heading_anchor,
          disposition: {
            display_level: 1,
            display_title: null,
            include_in_toc: true,
            kind: "expected_body" as const,
            role: "body" as const,
            starts_page: true,
          },
        },
        {
          anchor: third.body_heading_anchor,
          disposition: {
            display_level: 1,
            display_title: null,
            include_in_toc: true,
            kind: "expected_body" as const,
            role: "body" as const,
            starts_page: true,
          },
        },
      ],
    });
    const actual = observed(expanded);
    const actualRegion = actual.printed_contents.regions[0];
    if (!actualRegion) throw new Error("test fixture is incomplete");

    const result = compareMineruReferenceV2(expanded, {
      ...actual,
      printed_contents: {
        ...actual.printed_contents,
        regions: [{ ...actualRegion, entries: [first, third] }],
      },
    });

    expect(result.issues).toEqual([
      { code: "ENTRY_ORDER_MISMATCH", path: "regions/full-contents" },
      {
        code: "ENTRY_MISSING",
        path: "regions/full-contents/entries/chapter-two",
      },
    ]);
  });
});
