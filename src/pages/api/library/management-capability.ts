import type { APIRoute } from "astro";

import { resolveRuntimeAdministrator } from "@/http/authorization/runtime-admin";
import { applyResponsePolicy } from "@/http/cache/policies";

export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
  const { decision } = resolveRuntimeAdministrator(locals.session);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  applyResponsePolicy(headers, "private-api");
  return Response.json(
    { management_available: decision.allowed },
    { headers, status: 200 },
  );
};
