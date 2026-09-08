import { lstat, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { createOpaqueId } from "@/domain/ids";
import { contentLimits } from "../../core/content/book-document";

export interface CandidateDiagnostic {
  readonly code: string;
  readonly severity: "error" | "info" | "warning";
}
export interface MineruCandidate {
  readonly byteSize: number;
  readonly companionFiles: readonly string[];
  readonly confidence: "high";
  readonly diagnostics: readonly CandidateDiagnostic[];
  readonly firstHeading: string | null;
  readonly id: string;
  readonly normalizedPath: string;
  readonly referencedResources: number;
  readonly score: number;
}
export interface CandidateDiscovery {
  readonly candidates: readonly MineruCandidate[];
  readonly decision: "automatic" | "reject";
  readonly reason:
    | "mineru-v2"
    | "multiple-book-bundles"
    | "no-mineru-json"
    | "document-too-large";
  readonly selectedCandidateId: string | null;
}
export async function discoverMineruCandidates(
  rootInput: string,
): Promise<CandidateDiscovery> {
  const root = resolve(rootInput);
  const paths: string[] = [];
  const directories = [root];
  let count = 0;
  while (directories.length) {
    const directory = directories.pop();
    if (!directory) break;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (++count > 20000 || entry.isSymbolicLink())
        throw new Error("IMPORT_DIRECTORY_INVALID");
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) directories.push(path);
      else if (
        entry.isFile() &&
        /(?:^|_)content_list_v2\.json$/iu.test(entry.name)
      )
        paths.push(path);
    }
  }
  paths.sort();
  const candidates: MineruCandidate[] = [];
  for (const path of paths) {
    const size = (await lstat(path)).size;
    candidates.push({
      id: createOpaqueId("importCandidate"),
      byteSize: size,
      companionFiles: [],
      confidence: "high",
      firstHeading: null,
      normalizedPath: relative(root, path).split(sep).join("/"),
      referencedResources: 0,
      score: 100,
      diagnostics:
        size > contentLimits.bytes
          ? [{ code: "CONTENT_FILE_LIMIT_EXCEEDED", severity: "error" }]
          : [],
    });
  }
  const candidate = candidates[0];
  if (candidates.length !== 1 || !candidate)
    return {
      candidates,
      decision: "reject",
      reason: candidates.length ? "multiple-book-bundles" : "no-mineru-json",
      selectedCandidateId: null,
    };
  if (candidate.diagnostics.length)
    return {
      candidates,
      decision: "reject",
      reason: "document-too-large",
      selectedCandidateId: null,
    };
  return {
    candidates,
    decision: "automatic",
    reason: "mineru-v2",
    selectedCandidateId: candidate.id,
  };
}
