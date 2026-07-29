import { createHash } from "node:crypto";

import { canonicalJson } from "@/modules/publishing/core/publication/manifest";
import {
  buildSearchSpool,
  type SearchSpool,
} from "@/modules/publishing/core/publication/search-model";
import { atomicWriteFile } from "@/platform/filesystem/layout";

export { buildSearchSpool };

export async function writeSearchSpool(
  path: string,
  spool: SearchSpool,
): Promise<void> {
  await atomicWriteFile(path, canonicalJson(spool), { mode: 0o400 });
}

export function parseSearchSpool(value: string): SearchSpool {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SEARCH_SPOOL_INVALID");
  }
  const spool = parsed as Record<string, unknown>;
  if (
    spool.schemaVersion !== 1 ||
    typeof spool.digest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(spool.digest) ||
    !Array.isArray(spool.ftsRows) ||
    !Array.isArray(spool.shortRows)
  ) {
    throw new Error("SEARCH_SPOOL_INVALID");
  }
  const payload = {
    ftsRows: spool.ftsRows,
    schemaVersion: 1,
    shortRows: spool.shortRows,
  };
  if (
    createHash("sha256").update(canonicalJson(payload)).digest("hex") !==
    spool.digest
  ) {
    throw new Error("SEARCH_SPOOL_HASH_MISMATCH");
  }
  return parsed as SearchSpool;
}
