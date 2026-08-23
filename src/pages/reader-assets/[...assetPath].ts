import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { APIRoute } from "astro";

import { acceptedReaderAssetPath } from "@/modules/reader/application/reader-api";
import { SafeApplicationError } from "@/domain/errors";
import { applyResponsePolicy } from "@/http/cache/policies";

export const prerender = false;

function contentType(path: string): string {
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".woff2")) return "font/woff2";
  return "text/plain; charset=utf-8";
}

async function assetBytes(path: string): Promise<Uint8Array> {
  const roots = [
    resolve(process.cwd(), "public", "_astro"),
    resolve(process.cwd(), "dist", "client", "_astro"),
  ];
  for (const root of roots) {
    try {
      return await readFile(resolve(root, path));
    } catch {
      // The production image contains dist/client; source and dev use public.
    }
  }
  throw new SafeApplicationError(
    "NOT_FOUND",
    "The reader asset was not found.",
    404,
  );
}

async function response(
  assetPath: string | undefined,
  includeBody: boolean,
): Promise<Response> {
  const path = acceptedReaderAssetPath(assetPath);
  if (!path) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The reader asset was not found.",
      404,
    );
  }
  const bytes = await assetBytes(path);
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Content-Length": String(bytes.byteLength),
    "Content-Type": contentType(path),
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "site-static");
  return new Response(includeBody ? Uint8Array.from(bytes).buffer : null, {
    headers,
  });
}

export const GET: APIRoute = async ({ params }) =>
  response(params.assetPath, true);

export const HEAD: APIRoute = async ({ params }) =>
  response(params.assetPath, false);

export const OPTIONS: APIRoute = ({ params }) => {
  if (!acceptedReaderAssetPath(params.assetPath)) {
    throw new SafeApplicationError(
      "NOT_FOUND",
      "The reader asset was not found.",
      404,
    );
  }
  const headers = new Headers({
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Max-Age": "86400",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "site-static");
  return new Response(null, { headers, status: 204 });
};
