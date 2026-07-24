import { randomBytes } from "node:crypto";

export interface RequestContext {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly startedAtMs: number;
}

export function createRequestId(): string {
  return `req_${randomBytes(18).toString("base64url")}`;
}

export function createRequestContext(
  request: Request,
  nowMs = Date.now(),
): RequestContext {
  return Object.freeze({
    id: createRequestId(),
    method: request.method.toUpperCase(),
    path: new URL(request.url).pathname,
    startedAtMs: nowMs,
  });
}
