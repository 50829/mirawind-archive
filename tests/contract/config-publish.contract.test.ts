import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const contractPath = fileURLToPath(
  new URL(
    "../../specs/001-mineru-public-publishing/contracts/openapi.yaml",
    import.meta.url,
  ),
);
let contractPromise: Promise<Record<string, unknown>> | undefined;

function contract(): Promise<Record<string, unknown>> {
  contractPromise ??= readFile(contractPath, "utf8").then(
    (source) => parse(source) as Record<string, unknown>,
  );
  return contractPromise;
}

function at(
  value: Record<string, unknown>,
  ...keys: readonly string[]
): Record<string, unknown> {
  let current: unknown = value;
  for (const key of keys) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      throw new Error(`Missing contract path ${keys.join(".")}`);
    }
    current = (current as Record<string, unknown>)[key];
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    throw new Error(`Contract path is not an object: ${keys.join(".")}`);
  }
  return current as Record<string, unknown>;
}

describe("configuration and atomic-publication OpenAPI contract", () => {
  it("requires a strong ETag precondition for patching a draft", async () => {
    const document = await contract();
    const operation = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/draft",
      "patch",
    );
    const parameters = operation.parameters as readonly Record<
      string,
      unknown
    >[];

    expect(operation.operationId).toBe("patchDraftConfig");
    expect(parameters).toContainEqual(
      expect.objectContaining({
        in: "header",
        name: "If-Match",
        required: true,
      }),
    );
    expect(at(operation, "responses")).toHaveProperty("202");
    expect(at(operation, "responses")).toHaveProperty("412");
    expect(
      at(
        operation,
        "requestBody",
        "content",
        "application/json",
        "schema",
        "properties",
        "numbering",
      ).enum,
    ).toEqual(["source", "generated", "none"]);
  });

  it("describes the current draft read, patch and accepted response models", async () => {
    const document = await contract();
    const schemas = at(document, "components", "schemas");
    const draft = at(schemas, "Draft");
    const draftProperties = at(draft, "properties");
    const previewAlternatives = at(draftProperties, "preview")
      .oneOf as readonly Record<string, unknown>[];
    const previewProperties = at(previewAlternatives[0] ?? {}, "properties");
    const structureProperties = at(
      draftProperties,
      "structure",
      "items",
      "properties",
    );
    const patch = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/draft",
      "patch",
      "requestBody",
      "content",
      "application/json",
      "schema",
    );
    const patchProperties = at(patch, "properties");
    const changeProperties = at(
      patchProperties,
      "changes",
      "items",
      "properties",
    );
    const accepted = at(schemas, "DraftUpdateAccepted");

    expect(draft.required).toEqual([
      "access",
      "alias",
      "boundaries",
      "book_id",
      "candidate",
      "candidate_published",
      "config_revision",
      "diagnostics",
      "metadata",
      "numbering",
      "published",
      "preview",
      "structure",
      "title",
    ]);
    expect(draftProperties).not.toHaveProperty("regions");
    expect(draftProperties).not.toHaveProperty("preview_state");
    expect(previewProperties).not.toHaveProperty("source_regions");
    expect(previewProperties.compiler_version).toMatchObject({
      const: "compiler-v6",
    });
    expect(structureProperties).toHaveProperty("title_markdown");
    expect(structureProperties).toHaveProperty("source_number");
    expect(structureProperties).not.toHaveProperty("display_title");
    expect(structureProperties).not.toHaveProperty("role");
    expect(Object.keys(patchProperties).sort()).toEqual([
      "alias",
      "boundaries",
      "changes",
      "metadata",
      "numbering",
    ]);
    expect(Object.keys(changeProperties).sort()).toEqual([
      "alias",
      "block_id",
      "display_level",
      "include_in_toc",
      "source_number",
      "starts_page",
      "title_markdown",
    ]);
    expect(accepted.required).toEqual([
      "book_id",
      "candidate",
      "config_revision",
    ]);
  });

  it("publishes the server-selected ready candidate with a config precondition", async () => {
    const document = await contract();
    const operation = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/publish",
      "post",
    );
    const parameters = operation.parameters as readonly Record<
      string,
      unknown
    >[];
    const body = at(
      operation,
      "requestBody",
      "content",
      "application/json",
      "schema",
    );

    expect(operation.operationId).toBe("publishBook");
    expect(parameters).toContainEqual(
      expect.objectContaining({
        in: "header",
        name: "If-Match",
        required: true,
      }),
    );
    expect(body).toMatchObject({
      additionalProperties: false,
    });
    expect(at(body, "properties")).toEqual({});
    expect(at(operation, "responses")).toHaveProperty("200");
    expect(at(operation, "responses")).toHaveProperty("412");
  });

  it("reprocesses retained source into a new preconditioned draft revision", async () => {
    const document = await contract();
    const operation = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/reprocess",
      "post",
    );
    const body = at(
      operation,
      "requestBody",
      "content",
      "application/json",
      "schema",
    );

    expect(operation.operationId).toBe("reprocessDraftSource");
    expect(body).toMatchObject({
      additionalProperties: false,
      required: ["expected_config_revision", "profile"],
    });
    expect(at(body, "properties", "profile").enum).toEqual([
      "verbatim-v1",
      "zh-smart-v2",
    ]);
    expect(at(operation, "responses")).toHaveProperty("202");
    expect(at(operation, "responses")).toHaveProperty("409");
  });

  it("changes private or public access independently from publication", async () => {
    const document = await contract();
    const operation = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/access",
      "patch",
    );
    expect(operation.operationId).toBe("setBookAccess");
    expect(
      at(
        operation,
        "requestBody",
        "content",
        "application/json",
        "schema",
        "properties",
        "access",
      ).enum,
    ).toEqual(["private", "public"]);
  });
});
