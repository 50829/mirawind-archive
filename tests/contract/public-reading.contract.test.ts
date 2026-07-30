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

describe("public reading, search and original-download OpenAPI contract", () => {
  it("freezes current page and version-pinned asset representations", async () => {
    const document = await contract();
    const page = at(document, "paths", "/read/{bookKey}/{pageKey}", "get");
    const asset = at(
      document,
      "paths",
      "/books/{bookKey}/assets/{versionId}/{resourceId}",
      "get",
    );

    expect(page.operationId).toBe("readPublishedPage");
    expect(at(page, "responses")).toHaveProperty("200");
    expect(at(page, "responses")).toHaveProperty("304");
    expect(at(page, "responses")).toHaveProperty("404");
    expect(at(page, "responses")).toHaveProperty("503");
    expect(asset.operationId).toBe("readPublishedAsset");
    expect(at(asset, "responses")).toHaveProperty("200");
    expect(at(asset, "responses")).toHaveProperty("304");
    expect(at(asset, "responses")).toHaveProperty("404");
  });

  it("freezes bounded current-version search", async () => {
    const document = await contract();
    const search = at(document, "paths", "/api/books/{bookKey}/search", "get");

    expect(search.operationId).toBe("searchPublishedBook");
    expect(search.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "q", required: true }),
        expect.objectContaining({ name: "limit", required: false }),
        expect.objectContaining({ name: "cursor", required: false }),
      ]),
    );
    expect(at(search, "responses")).toHaveProperty("200");
    expect(at(search, "responses")).toHaveProperty("400");
    expect(at(search, "responses")).toHaveProperty("404");
  });

  it("freezes complete, single-range and unsatisfiable original responses", async () => {
    const document = await contract();
    const download = at(
      document,
      "paths",
      "/books/{bookKey}/originals/{fileId}",
      "get",
    );

    expect(download.operationId).toBe("downloadOriginal");
    expect(download.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Range", required: false }),
        expect.objectContaining({ name: "If-Range", required: false }),
        expect.objectContaining({
          $ref: "#/components/parameters/IfNoneMatch",
        }),
      ]),
    );
    expect(at(download, "responses")).toHaveProperty("200");
    expect(at(download, "responses")).toHaveProperty("206");
    expect(at(download, "responses")).toHaveProperty("304");
    expect(at(download, "responses")).toHaveProperty("404");
    expect(at(download, "responses")).toHaveProperty("416");
  });
});
