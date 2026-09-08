import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";

export interface ReferenceAnchor {
  readonly page_index: number;
  readonly source_index: number;
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
  readonly entry_key: string;
  readonly title: string;
  readonly level: number;
  readonly kind: ReferenceSemanticKind;
  readonly page_label: string | null;
}
export interface ReferenceContentsRegion {
  readonly region_key: string;
  readonly canonical: boolean;
  readonly pdf_page_indices: readonly number[];
  readonly source_range: {
    readonly start: ReferenceAnchor;
    readonly end: ReferenceAnchor;
  };
  readonly entries: readonly ReferenceContentsEntry[];
}
export interface MineruReference {
  readonly schema_version: 3;
  readonly fixture_id: string;
  readonly archive_sha256: string;
  readonly evidence_sha256: string;
  readonly content_json: {
    readonly relative_path: string;
    readonly input_sha256: string;
  };
  readonly original_pdf: {
    readonly relative_path: string;
    readonly sha256: string;
    readonly page_count: number;
  };
  readonly printed_contents: {
    readonly state: "present" | "absent";
    readonly regions: readonly ReferenceContentsRegion[];
  };
}
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const key = {
  type: "string",
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  maxLength: 120,
};
const path = { type: "string", minLength: 1, maxLength: 4096 };
const anchor = {
  type: "object",
  additionalProperties: false,
  required: ["page_index", "source_index"],
  properties: {
    page_index: { type: "integer", minimum: 0, maximum: 10000 },
    source_index: { type: "integer", minimum: 0, maximum: 20000 },
  },
};
const validate = new Ajv2020({ strict: true }).compile({
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "fixture_id",
    "archive_sha256",
    "evidence_sha256",
    "content_json",
    "original_pdf",
    "printed_contents",
  ],
  properties: {
    schema_version: { const: 3 },
    fixture_id: { type: "string", pattern: "^real-mineru-[a-z0-9]{6,32}$" },
    archive_sha256: hash,
    evidence_sha256: hash,
    content_json: {
      type: "object",
      additionalProperties: false,
      required: ["relative_path", "input_sha256"],
      properties: { relative_path: path, input_sha256: hash },
    },
    original_pdf: {
      type: "object",
      additionalProperties: false,
      required: ["relative_path", "sha256", "page_count"],
      properties: {
        relative_path: path,
        sha256: hash,
        page_count: { type: "integer", minimum: 1, maximum: 10000 },
      },
    },
    printed_contents: {
      type: "object",
      additionalProperties: false,
      required: ["state", "regions"],
      properties: {
        state: { enum: ["present", "absent"] },
        regions: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "region_key",
              "canonical",
              "pdf_page_indices",
              "source_range",
              "entries",
            ],
            properties: {
              region_key: key,
              canonical: { type: "boolean" },
              pdf_page_indices: {
                type: "array",
                minItems: 1,
                maxItems: 100,
                uniqueItems: true,
                items: { type: "integer", minimum: 0 },
              },
              source_range: {
                type: "object",
                additionalProperties: false,
                required: ["start", "end"],
                properties: { start: anchor, end: anchor },
              },
              entries: {
                type: "array",
                minItems: 1,
                maxItems: 20000,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "entry_key",
                    "title",
                    "level",
                    "kind",
                    "page_label",
                  ],
                  properties: {
                    entry_key: key,
                    title: { type: "string", minLength: 1, maxLength: 1000 },
                    level: { type: "integer", minimum: 1, maximum: 4 },
                    kind: {
                      enum: [
                        "part",
                        "chapter",
                        "section",
                        "appendix",
                        "frontmatter",
                        "backmatter",
                        "other",
                      ],
                    },
                    page_label: { type: ["string", "null"], maxLength: 32 },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});
export function anchorKey(anchor: ReferenceAnchor): string {
  return `${anchor.page_index}:${anchor.source_index}`;
}
export function compareAnchors(
  left: ReferenceAnchor,
  right: ReferenceAnchor,
): number {
  return (
    left.page_index - right.page_index || left.source_index - right.source_index
  );
}
export function parseMineruReference(value: unknown): MineruReference {
  if (!validate(value)) throw new Error("REFERENCE_SCHEMA_INVALID");
  const reference = value as MineruReference;
  for (const file of [
    reference.content_json.relative_path,
    reference.original_pdf.relative_path,
  ]) {
    if (
      file.startsWith("/") ||
      file.includes("\\") ||
      file.includes(":") ||
      file.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error("REFERENCE_PATH_INVALID");
  }
  const regions = reference.printed_contents.regions;
  if (
    reference.printed_contents.state === "absent"
      ? regions.length !== 0
      : regions.filter((region) => region.canonical).length !== 1
  )
    throw new Error("REFERENCE_CONTENTS_STATE_INVALID");
  if (
    new Set(regions.map((region) => region.region_key)).size !== regions.length
  )
    throw new Error("REFERENCE_REGION_DUPLICATE");
  const entries = regions.flatMap((region) => region.entries);
  if (new Set(entries.map((entry) => entry.entry_key)).size !== entries.length)
    throw new Error("REFERENCE_ENTRY_DUPLICATE");
  for (const [index, region] of regions.entries()) {
    if (
      compareAnchors(region.source_range.start, region.source_range.end) > 0 ||
      region.source_range.end.page_index >= reference.original_pdf.page_count ||
      region.pdf_page_indices.some(
        (page, index, values) =>
          page >= reference.original_pdf.page_count ||
          (index > 0 && page <= (values[index - 1] ?? -1)),
      )
    )
      throw new Error("REFERENCE_REGION_RANGE_INVALID");
    const previous = regions[index - 1];
    if (
      previous &&
      compareAnchors(previous.source_range.end, region.source_range.start) >= 0
    )
      throw new Error("REFERENCE_REGION_OVERLAP");
  }
  return reference;
}
export async function readMineruReference(
  path: string,
): Promise<MineruReference> {
  const source = await readFile(path, "utf8");
  if (Buffer.byteLength(source) > 16 * 1024 * 1024)
    throw new Error("REFERENCE_SIZE_LIMIT");
  return parseMineruReference(JSON.parse(source));
}
