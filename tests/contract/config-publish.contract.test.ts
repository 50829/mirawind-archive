import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const contractPath = fileURLToPath(
  new URL(
    "../../specs/001-mineru-public-publishing/contracts/openapi.yaml",
    import.meta.url,
  ),
);
const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

async function contract(): Promise<Record<string, unknown>> {
  return parse(await readFile(contractPath, "utf8")) as Record<string, unknown>;
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
  });

  it("freezes guarded publish enqueue without a fabricated rights field", async () => {
    const document = await contract();
    const operation = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/publish",
      "post",
    );
    const body = at(
      operation,
      "requestBody",
      "content",
      "application/json",
      "schema",
    );

    expect(operation.operationId).toBe("publishBook");
    expect(body).toMatchObject({
      additionalProperties: false,
      required: ["expected_config_revision"],
    });
    expect(at(body, "properties")).not.toHaveProperty("rights_confirmed");
    expect(at(operation, "responses")).toHaveProperty("202");
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
      "zh-smart-v1",
    ]);
    expect(at(operation, "responses")).toHaveProperty("202");
    expect(at(operation, "responses")).toHaveProperty("409");
  });

  it("allows only an immediate transition to draft or private", async () => {
    const document = await contract();
    const operation = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/visibility",
      "patch",
    );
    expect(operation.operationId).toBe("makeBookNonPublic");
    expect(
      at(
        operation,
        "requestBody",
        "content",
        "application/json",
        "schema",
        "properties",
        "visibility",
      ).enum,
    ).toEqual(["draft", "private"]);
  });

  it("has concrete handlers for each mutating operation", async () => {
    const draftSource = await readFile(
      `${projectRoot}src/pages/api/manage/books/[bookId]/draft.ts`,
      "utf8",
    );
    expect(draftSource).toContain("export const PATCH");
    await Promise.all(
      [
        "src/pages/api/manage/books/[bookId]/publish.ts",
        "src/pages/api/manage/books/[bookId]/reprocess.ts",
        "src/pages/api/manage/books/[bookId]/visibility.ts",
      ].map((path) => access(`${projectRoot}${path}`)),
    );
  });
});
