import type { APIRoute } from "astro";

import { getRuntimeAuth } from "@/auth/session";

export const prerender = false;

export const ALL: APIRoute = async ({ request }) => {
  return getRuntimeAuth().handler(request);
};
