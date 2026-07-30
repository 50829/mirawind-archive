import { randomBytes } from "node:crypto";

const prefixes = {
  block: "blk",
  deletion: "del",
  draftCandidate: "candidate",
  file: "file",
  import: "imp",
  importCandidate: "cand",
  job: "job",
  region: "region",
  resource: "res",
  source: "src",
  version: "ver",
} as const;

export type OpaqueIdKind = keyof typeof prefixes;

export function createOpaqueId(kind: OpaqueIdKind): string {
  return `${prefixes[kind]}_${randomBytes(18).toString("base64url")}`;
}

export function isOpaqueId(kind: OpaqueIdKind, value: string): boolean {
  return new RegExp(`^${prefixes[kind]}_[A-Za-z0-9_-]{16,80}$`).test(value);
}
