import { createHash } from "node:crypto";

import type { APIRoute } from "astro";

import {
  createPublishedBookServer,
  createReaderServer,
} from "@/composition/server";
import { normalizeSearchQuery } from "@/modules/reader/application/public";
import { SafeApplicationError } from "@/domain/errors";
import { resolveRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy, createStrongEtag } from "@/http/cache/policies";
import { ifNoneMatchMatches } from "@/http/conditional";
import { noIndexRobotsTag } from "@/http/seo/robots";
import { getRuntimeStorageLayout } from "@/composition/storage";

export const prerender = false;

interface SearchCursor {
  readonly offset: number;
  readonly queryHash: string;
  readonly versionId: string;
}

function queryHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function decodeCursor(
  value: string | null,
  versionId: string,
  query: string,
): number {
  if (!value) return 0;
  if (value.length > 500) throw new Error("SEARCH_CURSOR_INVALID");
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as SearchCursor;
    if (
      !Number.isSafeInteger(parsed.offset) ||
      parsed.offset < 1 ||
      parsed.offset > 1_000_000 ||
      parsed.versionId !== versionId ||
      parsed.queryHash !== queryHash(query)
    ) {
      throw new Error("SEARCH_CURSOR_INVALID");
    }
    return parsed.offset;
  } catch (cause) {
    throw new SafeApplicationError(
      "SEARCH_CURSOR_INVALID",
      "The search cursor is invalid or stale.",
      400,
      { cause },
    );
  }
}

function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function limitFrom(value: string | null): number {
  if (!value) return 20;
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new SafeApplicationError(
      "SEARCH_LIMIT_INVALID",
      "The search limit must be an integer from 1 to 50.",
      400,
    );
  }
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > 50) {
    throw new SafeApplicationError(
      "SEARCH_LIMIT_INVALID",
      "The search limit must be an integer from 1 to 50.",
      400,
    );
  }
  return limit;
}

export const GET: APIRoute = async ({ locals, params, request }) => {
  const url = new URL(request.url);
  let query;
  try {
    query = normalizeSearchQuery(url.searchParams.get("q") ?? "");
  } catch (cause) {
    throw new SafeApplicationError(
      "SEARCH_QUERY_INVALID",
      "The search query must contain 1 to 200 Unicode characters.",
      400,
      { cause },
    );
  }
  const limit = limitFrom(url.searchParams.get("limit"));
  const { database, decision } = resolveRuntimeAdministrator(locals.session);
  const layout = await getRuntimeStorageLayout();
  const book = createPublishedBookServer(database, layout).resolveCurrent(
    params.bookKey ?? "",
    decision,
  );
  const offset = decodeCursor(
    url.searchParams.get("cursor"),
    book.versionId,
    query.normalized,
  );
  const rows = createReaderServer(database).search({
    bookId: book.bookId,
    bookKey: book.alias ?? String(book.bookId),
    limit: limit + 1,
    offset,
    query,
    requirePublic: book.visibility === "public",
    versionId: book.versionId,
  });
  const results = rows.slice(0, limit).map((row) => ({
    block_id: row.blockId,
    book_id: row.bookId,
    href: row.href,
    kind: row.kind,
    page_id: row.pageId,
    snippet: row.snippet,
    title: row.title,
  }));
  const nextCursor =
    rows.length > limit
      ? encodeCursor({
          offset: offset + limit,
          queryHash: queryHash(query.normalized),
          versionId: book.versionId,
        })
      : null;
  const etag = createStrongEtag(
    "book-search-v1",
    book.versionId,
    query.normalized,
    String(limit),
    String(offset),
  );
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(
    headers,
    book.visibility === "public" ? "public-html" : "private",
  );
  headers.set("X-Robots-Tag", noIndexRobotsTag);
  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    headers.delete("Content-Type");
    return new Response(null, { headers, status: 304 });
  }
  return Response.json(
    {
      next_cursor: nextCursor,
      notice:
        query.scope === "metadata_heading_only"
          ? "1–2 个字符只搜索书名、作者和章节标题；正文搜索至少需要 3 个字符。"
          : null,
      query: query.normalized,
      results,
      scope: query.scope,
    },
    { headers },
  );
};
