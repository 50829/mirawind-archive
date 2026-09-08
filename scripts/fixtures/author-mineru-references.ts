import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseMineruReference,
  anchorKey,
  type MineruReference,
} from "./mineru-reference.js";
import type { MineruReferencePack } from "./create-mineru-reference-pack.js";

export function acceptReviewedReference(
  pack: MineruReferencePack,
  value: unknown,
): MineruReference {
  const reference = parseMineruReference(value);
  if (
    pack.schema_version !== 2 ||
    reference.fixture_id !== pack.fixture_id ||
    reference.archive_sha256 !== pack.archive_sha256 ||
    reference.content_json.input_sha256 !== pack.content_json.input_sha256 ||
    reference.content_json.relative_path !== pack.content_json.relative_path ||
    !pack.pdf_documents.some(
      (pdf) =>
        pdf.relative_path === reference.original_pdf.relative_path &&
        pdf.sha256 === reference.original_pdf.sha256 &&
        pdf.page_count === reference.original_pdf.page_count,
    )
  )
    throw new Error("REFERENCE_REVIEW_BINDING_MISMATCH");
  const records = new Set(pack.content_json.records.map(anchorKey));
  if (
    reference.printed_contents.regions.some(
      (region) =>
        !records.has(anchorKey(region.source_range.start)) ||
        !records.has(anchorKey(region.source_range.end)),
    )
  )
    throw new Error("REFERENCE_SOURCE_ANCHOR_MISSING");
  return reference;
}

async function main(): Promise<void> {
  const [packPath, reviewedPath, outputPath] = process.argv.slice(2);
  if (!packPath || !reviewedPath || !outputPath)
    throw new Error("Required: pack.json reviewed.json output.json");
  const pack = JSON.parse(
    await readFile(packPath, "utf8"),
  ) as MineruReferencePack;
  const reference = acceptReviewedReference(
    pack,
    JSON.parse(await readFile(reviewedPath, "utf8")),
  );
  await writeFile(outputPath, JSON.stringify(reference, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  process.stdout.write(
    JSON.stringify({ fixture_id: reference.fixture_id, accepted: true }) + "\n",
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
