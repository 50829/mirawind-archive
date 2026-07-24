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

describe("import and draft-preview OpenAPI contract", () => {
  it("freezes the import create, inspect and candidate-confirmation operations", async () => {
    const document = await contract();
    const create = at(document, "paths", "/api/manage/imports", "post");
    const inspect = at(
      document,
      "paths",
      "/api/manage/imports/{importId}",
      "get",
    );
    const confirm = at(
      document,
      "paths",
      "/api/manage/imports/{importId}/main-markdown",
      "put",
    );

    expect(create.operationId).toBe("createImport");
    expect(at(create, "responses")).toHaveProperty("202");
    expect(at(create, "responses")).toHaveProperty("413");
    expect(inspect.operationId).toBe("getImport");
    expect(confirm.operationId).toBe("confirmMainMarkdown");
    expect(
      at(confirm, "requestBody", "content", "application/json", "schema"),
    ).toMatchObject({
      additionalProperties: false,
      required: ["candidate_id"],
    });
  });

  it("freezes revision-pinned draft page and asset paths with private responses", async () => {
    const document = await contract();
    const draft = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/draft",
      "get",
    );
    const page = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/preview/{configRevision}/pages/{pageId}",
      "get",
    );
    const asset = at(
      document,
      "paths",
      "/api/manage/books/{bookId}/preview/{configRevision}/assets/{resourceId}",
      "get",
    );

    expect(draft.operationId).toBe("getBookDraft");
    expect(page.operationId).toBe("readDraftPreviewPage");
    expect(asset.operationId).toBe("readDraftPreviewAsset");
    expect(at(page, "responses")).toHaveProperty("404");
    expect(at(asset, "responses")).toHaveProperty("404");
    expect(at(document, "components", "schemas", "Draft")).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining([
        "book_id",
        "source_id",
        "config_revision",
        "preview_state",
      ]),
    });
  });

  it("has concrete Astro handlers for every US1 contract path", async () => {
    await Promise.all(
      [
        "src/pages/api/manage/imports/index.ts",
        "src/pages/api/manage/imports/[importId]/index.ts",
        "src/pages/api/manage/imports/[importId]/main-markdown.ts",
        "src/pages/api/manage/books/[bookId]/draft.ts",
        "src/pages/api/manage/books/[bookId]/preview/[configRevision]/pages/[pageId].ts",
        "src/pages/api/manage/books/[bookId]/preview/[configRevision]/assets/[resourceId].ts",
      ].map((path) => access(`${projectRoot}${path}`)),
    );
  });
});
