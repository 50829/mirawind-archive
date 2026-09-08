import SwaggerParser from "@apidevtools/swagger-parser";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";

const document = SwaggerParser.dereference(
  "specs/001-mineru-public-publishing/contracts/openapi.yaml",
);
const ajv = addFormats(new Ajv2020({ strict: false }));
const timestamp = 1788739200000;
const candidateId = "candidate_000000000000000000000001";
function at(
  value: unknown,
  ...keys: (string | number)[]
): Record<string, unknown> {
  for (const key of keys) value = (value as Record<string, unknown>)[key];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("CONTRACT_NODE_MISSING");
  return value as Record<string, unknown>;
}
describe("IR management HTTP contract", () => {
  it("requires draft timestamps and accepts subtree exclusions", async () => {
    const patch = at(
      await document,
      "paths",
      "/api/manage/books/{bookId}/draft",
      "patch",
    );
    const validate = ajv.compile(
      at(patch, "requestBody", "content", "application/json", "schema"),
    );
    const edit = {
      expected_updated_at: timestamp,
      changes: [
        {
          block_id: "blk_000000000000000000000001",
          exclude_from_numbering: true,
        },
      ],
    };
    expect(validate(edit)).toBe(true);
    for (const invalid of [
      { changes: edit.changes },
      { ...edit, expected_updated_at: "1000" },
      { ...edit, expected_updated_at: -1 },
      { ...edit, unknown: true },
    ])
      expect(validate(invalid)).toBe(false);
    expect(
      at(patch, "responses", 202, "headers", "Cache-Control", "schema").const,
    ).toBe("private, no-store");
    expect(at(patch, "responses")[412]).toBeDefined();
  });
  it("binds publication to the exact candidate and accepted source time", async () => {
    const operation = at(
      await document,
      "paths",
      "/api/manage/books/{bookId}/publish",
      "post",
    );
    const validate = ajv.compile(
      at(operation, "requestBody", "content", "application/json", "schema"),
    );
    expect(
      validate({ expected_updated_at: timestamp, candidate_id: candidateId }),
    ).toBe(true);
    expect(validate({ expected_updated_at: timestamp })).toBe(false);
    expect(validate({ candidate_id: candidateId })).toBe(false);
    expect(at(operation, "responses")[409]).toBeDefined();
  });
  it("describes asynchronous receipts and accepted timestamps on tasks", async () => {
    const api = await document;
    const validate = ajv.compile(
      at(api, "components", "schemas", "DraftUpdateAccepted"),
    );
    expect(
      validate({
        job_id: "job_000000000000000000000001",
        state: "queued",
        expected_updated_at: timestamp,
      }),
    ).toBe(true);
    expect(validate({ state: "queued", expected_updated_at: timestamp })).toBe(
      false,
    );
    const job = at(api, "components", "schemas", "Job", "properties");
    expect(at(job, "kind").enum).toContain("save_draft");
    expect(at(job, "accepted_updated_at").maximum).toBe(8640000000000000);
  });
  it("keeps candidate pages private and requires signed resource authorization", async () => {
    const api = await document;
    const page = at(
      api,
      "paths",
      "/api/manage/books/{bookId}/preview/{candidateId}/pages/{pageId}",
      "get",
    );
    const asset = at(
      api,
      "paths",
      "/api/manage/books/{bookId}/preview/{candidateId}/assets/{resourceId}",
      "get",
    );
    for (const operation of [page, asset]) {
      expect(
        at(operation, "responses", 200, "headers", "Cache-Control", "schema")
          .const,
      ).toBe("private, no-store");
      expect(
        at(operation, "responses", 200, "headers", "X-Robots-Tag", "schema")
          .const,
      ).toContain("noindex");
      expect(at(operation, "responses")[404]).toBeDefined();
    }
    expect(asset.security).toEqual([{ previewAuthorization: [] }]);
    expect(
      at(api, "components", "securitySchemes", "previewAuthorization"),
    ).toMatchObject({ in: "query", name: "authorization" });
  });
});
