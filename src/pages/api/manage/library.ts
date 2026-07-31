import type { APIRoute } from "astro";

import { createCatalogServer } from "@/composition/server";
import { SafeApplicationError } from "@/domain/errors";
import { requireRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";

export const prerender = false;

function limit(value: string | null): number {
  if (value === null) return 100;
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new SafeApplicationError(
      "LIBRARY_LIMIT_INVALID",
      "The library limit must be an integer from 1 to 100.",
      400,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 100) {
    throw new SafeApplicationError(
      "LIBRARY_LIMIT_INVALID",
      "The library limit must be an integer from 1 to 100.",
      400,
    );
  }
  return parsed;
}

function decodeCursor(value: string | null): number | null {
  if (value === null) return null;
  if (value.length > 200) {
    throw new SafeApplicationError(
      "LIBRARY_CURSOR_INVALID",
      "The library cursor is invalid.",
      400,
    );
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) throw new Error();
    return Number(parsed);
  } catch (cause) {
    throw new SafeApplicationError(
      "LIBRARY_CURSOR_INVALID",
      "The library cursor is invalid.",
      400,
      { cause },
    );
  }
}

function encodeCursor(bookId: number | null): string | null {
  return bookId === null
    ? null
    : Buffer.from(JSON.stringify(bookId), "utf8").toString("base64url");
}

export const GET: APIRoute = ({ locals, request }) => {
  const { database } = requireRuntimeAdministrator(locals.session);
  const url = new URL(request.url);
  const page = createCatalogServer(database).administratorLibrary({
    afterBookId: decodeCursor(url.searchParams.get("cursor")),
    limit: limit(url.searchParams.get("limit")),
  });
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    {
      entries: page.entries.map((entry) => ({
        access: entry.access,
        book_id: entry.bookId,
        current_version_available: entry.currentVersionAvailable,
        deletion_mutation_token: entry.deletionMutationToken,
        management_href: entry.managementHref,
        reading_href: entry.readingHref,
        status_label: entry.statusLabel,
        title: entry.title,
      })),
      next_cursor: encodeCursor(page.nextBookId),
    },
    { headers },
  );
};
