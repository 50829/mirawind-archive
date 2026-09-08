import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { compile } from "json-schema-to-typescript";
import { format, resolveConfig } from "prettier";

const destination = new URL(
  "../src/modules/publishing/core/content/book-document.generated.ts",
  import.meta.url,
);

const schema = JSON.parse(
  await readFile(
    new URL("../docs/schemas/book.schema.json", import.meta.url),
    "utf8",
  ),
);
const generated = await compile(schema, "BookDocument", {
  additionalProperties: false,
  bannerComment:
    "/* Generated from docs/schemas/book.schema.json. Run pnpm generate:content-types. */",
  declareExternallyReferenced: true,
  ignoreMinAndMaxItems: true,
  maxItems: -1,
});
const source = await format(generated, {
  ...(await resolveConfig(fileURLToPath(destination))),
  filepath: fileURLToPath(destination),
});
if (process.argv.includes("--check")) {
  if ((await readFile(destination, "utf8")) !== source)
    throw new Error("Content types differ from the authoritative schema.");
} else {
  await writeFile(destination, source);
}
