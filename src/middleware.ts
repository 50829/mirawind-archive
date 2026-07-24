import { defineMiddleware } from "astro:middleware";

import { resolveRequestSession } from "@/auth/session";

export const onRequest = defineMiddleware(async ({ locals, request }, next) => {
  locals.session = await resolveRequestSession(request);
  return next();
});
