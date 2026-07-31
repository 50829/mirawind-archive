import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseMineruReferenceV2 } from "../../../scripts/fixtures/mineru-reference-v2";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function anchor(rootIndex: number, value: string) {
  return { root_index: rootIndex, sha256: hash(value) };
}

function reference() {
  return {
    archive_sha256: hash("archive"),
    expected_diagnostics: [
      {
        code: "PRINTED_TOC_UNMATCHED_ENTRY",
        location: { entry_key: "entry-missing", kind: "entry" },
        phase: "matching",
        recovery: ["select_structure"],
        severity: "warning",
      },
    ],
    fixture_id: "real-mineru-a7f31c",
    main_markdown: {
      input_sha256: hash("markdown"),
      relative_path: "bundle/full.md",
    },
    original_pdf: {
      page_count: 120,
      relative_path: "bundle/origin.pdf",
      sha256: hash("pdf"),
    },
    printed_contents: {
      regions: [
        {
          canonical: true,
          entries: [
            {
              body_heading_anchor: anchor(12, "body heading"),
              entry_key: "entry-chapter-one",
              expected_match: "matched",
              kind: "chapter",
              level: 1,
              page_label: "1",
              title: "Chapter 1 Introduction",
            },
            {
              body_heading_anchor: null,
              entry_key: "entry-missing",
              expected_match: "unmatched",
              kind: "section",
              level: 2,
              page_label: "7",
              title: "1.1 Missing",
            },
          ],
          markdown_range: {
            end: anchor(5, "last contents block"),
            start: anchor(2, "contents label"),
          },
          pdf_page_indices: [2, 3],
          region_key: "full-contents",
        },
      ],
      state: "present",
    },
    protected_ranges: [
      {
        end_byte: 120,
        kind: "path",
        sha256: hash("/资料/API,v1.md"),
        start_byte: 101,
      },
    ],
    raw_heading_accounting: [
      {
        anchor: anchor(2, "contents label"),
        disposition: { kind: "excluded", region_key: "full-contents" },
      },
      {
        anchor: anchor(12, "body heading"),
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
  };
}

describe("MinerU reference v2", () => {
  it("accepts a strict hash-bound reference", () => {
    const parsed = parseMineruReferenceV2(reference());

    expect(parsed).toMatchObject({
      fixture_id: "real-mineru-a7f31c",
      printed_contents: {
        state: "present",
        regions: [{ canonical: true, region_key: "full-contents" }],
      },
      schema_version: 2,
    });
    expect(Object.isFrozen(parsed.printed_contents.regions)).toBe(true);
  });

  it("rejects v1, unknown newer versions and unknown fields", () => {
    expect(() =>
      parseMineruReferenceV2({ ...reference(), schema_version: 1 }),
    ).toThrow(/schema_version must be 2/);
    expect(() =>
      parseMineruReferenceV2({ ...reference(), schema_version: 3 }),
    ).toThrow(/schema_version must be 2/);
    expect(() =>
      parseMineruReferenceV2({ ...reference(), proposal_output: [] }),
    ).toThrow(/missing or unexpected fields/);
  });

  it("rejects manual structure adjudication recoveries", () => {
    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        expected_diagnostics: [
          {
            ...reference().expected_diagnostics[0],
            recovery: ["enable_region"],
          },
        ],
      }),
    ).toThrow(/recovery\[0\] is invalid/);
  });

  it("requires exactly one canonical region when contents are present", () => {
    const first = reference().printed_contents.regions[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("missing test region");

    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        printed_contents: {
          regions: [{ ...first, canonical: false }],
          state: "present",
        },
      }),
    ).toThrow(/exactly one canonical region/);
    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        printed_contents: {
          regions: [first, { ...first, region_key: "brief-contents" }],
          state: "present",
        },
      }),
    ).toThrow(/exactly one canonical region/);
  });

  it("models an absent printed contents without regions or exclusions", () => {
    const noContents = {
      ...reference(),
      expected_diagnostics: [],
      printed_contents: { regions: [], state: "absent" },
      raw_heading_accounting: reference().raw_heading_accounting.slice(1),
    };

    expect(parseMineruReferenceV2(noContents).printed_contents.state).toBe(
      "absent",
    );
    expect(() =>
      parseMineruReferenceV2({
        ...noContents,
        printed_contents: reference().printed_contents,
      }),
    ).not.toThrow();
    expect(() =>
      parseMineruReferenceV2({
        ...noContents,
        printed_contents: {
          regions: reference().printed_contents.regions,
          state: "absent",
        },
      }),
    ).toThrow(/absent contents cannot have regions/);
  });

  it("rejects duplicate or inconsistent heading accounting", () => {
    const accounting = reference().raw_heading_accounting;
    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        raw_heading_accounting: [accounting[0], accounting[0]],
      }),
    ).toThrow(/heading anchors must be unique/);
    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        raw_heading_accounting: [
          {
            ...accounting[0],
            disposition: { kind: "excluded", region_key: "unknown-region" },
          },
          accounting[1],
        ],
      }),
    ).toThrow(/unknown excluded region/);
  });

  it("rejects heading roles that move backward across linear boundaries", () => {
    const body = reference().raw_heading_accounting[1];
    if (!body || body.disposition.kind !== "expected_body") {
      throw new Error("missing body heading");
    }

    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        raw_heading_accounting: [
          ...reference().raw_heading_accounting,
          {
            anchor: anchor(13, "late frontmatter"),
            disposition: {
              ...body.disposition,
              role: "frontmatter",
            },
          },
        ],
      }),
    ).toThrow(/roles must follow linear boundaries/);
  });

  it("rejects invalid ranges, pages and matched entry anchors", () => {
    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        protected_ranges: [
          { ...reference().protected_ranges[0], end_byte: 100 },
        ],
      }),
    ).toThrow(/range must not be empty/);
    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        printed_contents: {
          ...reference().printed_contents,
          regions: [
            {
              ...reference().printed_contents.regions[0],
              pdf_page_indices: [2, 120],
            },
          ],
        },
      }),
    ).toThrow(/outside the PDF/);
    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        printed_contents: {
          ...reference().printed_contents,
          regions: [
            {
              ...reference().printed_contents.regions[0],
              entries: [
                {
                  ...reference().printed_contents.regions[0]?.entries[0],
                  body_heading_anchor: null,
                },
              ],
            },
          ],
        },
      }),
    ).toThrow(/matched entries require a body heading anchor/);
  });

  it("rejects more than the bounded protected-range limit", () => {
    const item = reference().protected_ranges[0];
    if (!item) throw new Error("test fixture is incomplete");
    expect(() =>
      parseMineruReferenceV2({
        ...reference(),
        protected_ranges: Array.from({ length: 100_001 }, (_, index) => ({
          ...item,
          end_byte: index * 2 + 1,
          start_byte: index * 2,
        })),
      }),
    ).toThrow(/protected_ranges is invalid/);
  });
});
