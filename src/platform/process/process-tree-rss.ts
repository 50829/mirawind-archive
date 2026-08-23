import { readFile } from "node:fs/promises";

const defaultMaximumProcesses = 256;

export type ProcessTreeRssSample =
  | Readonly<{
      processCount: number;
      rssBytes: number;
      status: "available";
    }>
  | Readonly<{
      reason:
        | "invalid_process"
        | "process_limit"
        | "process_unavailable"
        | "unsupported_platform";
      status: "unavailable";
    }>;

interface ProcessTreeRssOptions {
  readonly maxProcesses?: number;
  readonly platform?: NodeJS.Platform | string;
  readonly readText?: (path: string) => Promise<string>;
}

function parseChildren(value: string): readonly number[] | null {
  const trimmed = value.trim();
  if (!trimmed) return Object.freeze([]);
  const children = trimmed.split(/\s+/u).map(Number);
  return children.every((pid) => Number.isSafeInteger(pid) && pid >= 1)
    ? Object.freeze(children)
    : null;
}

function parseRssBytes(value: string): number | null {
  const match = /^VmRSS:\s+([0-9]+)\s+kB$/mu.exec(value);
  if (!match) return null;
  const kibibytes = Number(match[1]);
  const bytes = kibibytes * 1_024;
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
}

export async function sampleProcessTreeRss(
  rootPid: number,
  options: ProcessTreeRssOptions = {},
): Promise<ProcessTreeRssSample> {
  if (!Number.isSafeInteger(rootPid) || rootPid < 1) {
    return Object.freeze({ reason: "invalid_process", status: "unavailable" });
  }
  if ((options.platform ?? process.platform) !== "linux") {
    return Object.freeze({
      reason: "unsupported_platform",
      status: "unavailable",
    });
  }
  const maximum = options.maxProcesses ?? defaultMaximumProcesses;
  if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 1_024) {
    throw new RangeError("PROCESS_TREE_LIMIT_INVALID");
  }
  const readText =
    options.readText ?? ((path: string) => readFile(path, "utf8"));
  const pending = [rootPid];
  const seen = new Set<number>();
  let rssBytes = 0;
  try {
    while (pending.length > 0) {
      const pid = pending.shift();
      if (!pid || seen.has(pid)) continue;
      if (seen.size >= maximum) {
        return Object.freeze({
          reason: "process_limit",
          status: "unavailable",
        });
      }
      seen.add(pid);
      const [status, childrenValue] = await Promise.all([
        readText(`/proc/${pid}/status`),
        readText(`/proc/${pid}/task/${pid}/children`),
      ]);
      const processRssBytes = parseRssBytes(status);
      const children = parseChildren(childrenValue);
      if (processRssBytes === null || children === null) {
        return Object.freeze({
          reason: "process_unavailable",
          status: "unavailable",
        });
      }
      rssBytes += processRssBytes;
      if (!Number.isSafeInteger(rssBytes)) {
        return Object.freeze({
          reason: "process_unavailable",
          status: "unavailable",
        });
      }
      for (const child of children) if (!seen.has(child)) pending.push(child);
      if (seen.size + pending.length > maximum) {
        return Object.freeze({
          reason: "process_limit",
          status: "unavailable",
        });
      }
    }
  } catch {
    return Object.freeze({
      reason: "process_unavailable",
      status: "unavailable",
    });
  }
  return Object.freeze({
    processCount: seen.size,
    rssBytes,
    status: "available",
  });
}
