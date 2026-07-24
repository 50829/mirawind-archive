import { createHash } from "node:crypto";

import { noIndexRobotsTag } from "../seo/robots.js";

export type ResponsePolicyKind =
  | "draft"
  | "hidden-or-missing"
  | "login"
  | "manage"
  | "original-download"
  | "private"
  | "private-api"
  | "public-html"
  | "public-versioned-resource"
  | "redirect"
  | "site-static";

export interface ResponsePolicy {
  readonly cacheControl: string;
  readonly robotsTag?: string;
}

const policies: Readonly<Record<ResponsePolicyKind, ResponsePolicy>> = {
  draft: {
    cacheControl: "private, no-store",
    robotsTag: noIndexRobotsTag,
  },
  "hidden-or-missing": {
    cacheControl: "no-store",
    robotsTag: noIndexRobotsTag,
  },
  login: {
    cacheControl: "private, no-store",
    robotsTag: noIndexRobotsTag,
  },
  manage: {
    cacheControl: "private, no-store",
    robotsTag: noIndexRobotsTag,
  },
  "original-download": {
    cacheControl: "private, no-store",
    robotsTag: noIndexRobotsTag,
  },
  private: {
    cacheControl: "private, no-store",
    robotsTag: noIndexRobotsTag,
  },
  "private-api": {
    cacheControl: "private, no-store",
    robotsTag: noIndexRobotsTag,
  },
  "public-html": {
    cacheControl: "public, max-age=0, must-revalidate",
  },
  "public-versioned-resource": {
    cacheControl: "private, max-age=31536000, immutable",
  },
  redirect: {
    cacheControl: "no-store",
    robotsTag: noIndexRobotsTag,
  },
  "site-static": {
    cacheControl: "public, max-age=31536000, immutable",
  },
};

export function responsePolicyFor(kind: ResponsePolicyKind): ResponsePolicy {
  return policies[kind];
}

export function applyResponsePolicy(
  headers: Headers,
  kind: ResponsePolicyKind,
): void {
  const policy = responsePolicyFor(kind);
  headers.set("Cache-Control", policy.cacheControl);
  if (policy.robotsTag) headers.set("X-Robots-Tag", policy.robotsTag);
  else headers.delete("X-Robots-Tag");
}

export function createStrongEtag(
  ...representationIdentity: readonly string[]
): string {
  const hash = createHash("sha256");
  for (const part of representationIdentity) {
    const bytes = Buffer.from(part, "utf8");
    hash.update(`${bytes.length}:`);
    hash.update(bytes);
  }
  return `"${hash.digest("base64url")}"`;
}
