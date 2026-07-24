import type { APIRoute } from "astro";

import { getRuntimeAuth } from "@/auth/session";

export const prerender = false;

export const ALL: APIRoute = async ({ request }) => {
  const response = await getRuntimeAuth().handler(request);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};
