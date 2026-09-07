import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";

import { unified } from "unified";
import remarkParse from "remark-parse";

import { createOpaqueId } from "@/domain/ids";

const maximumMarkdownBytes = 256 * 1024 * 1024;
const ignoredMarkdownNames = new Set([
  "changelog.md",
  "license.md",
  "readme.md",
]);

export interface CandidateDiagnostic {
  readonly code: string;
  readonly severity: "error" | "info" | "warning";
}

export interface MarkdownCandidate {
  readonly byteSize: number;
  readonly companionFiles: readonly string[];
  readonly confidence: "generic" | "high";
  readonly diagnostics: readonly CandidateDiagnostic[];
  readonly firstHeading: string | null;
  readonly id: string;
  readonly normalizedPath: string;
  readonly referencedResources: number;
  readonly score: number;
}

export interface CandidateDiscovery {
  readonly candidates: readonly MarkdownCandidate[];
  readonly decision: "automatic" | "confirmation" | "reject";
  readonly reason:
    | "ambiguous-candidates"
    | "cli-high-confidence"
    | "cloud-high-confidence"
    | "generic-single-markdown"
    | "missing-resources"
    | "multiple-book-bundles"
    | "no-markdown";
  readonly selectedCandidateId: string | null;
}

interface MarkdownNode {
  readonly children?: readonly MarkdownNode[];
  readonly depth?: number;
  readonly identifier?: string;
  readonly label?: string;
  readonly type?: string;
  readonly url?: string;
  readonly value?: string;
}

function posixRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function walkMarkdown(
  root: string,
  directory = root,
): Promise<readonly string[]> {
  const found: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    if (
      entry.name === "__MACOSX" ||
      entry.name.startsWith("._") ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walkMarkdown(root, path)));
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".md") &&
      !ignoredMarkdownNames.has(entry.name.toLowerCase())
    ) {
      found.push(path);
    }
  }
  return found;
}

function traverse(
  node: MarkdownNode,
  visit: (node: MarkdownNode) => void,
): void {
  visit(node);
  for (const child of node.children ?? []) traverse(child, visit);
}

function markdownEvidence(markdown: string): {
  readonly firstHeading: string | null;
  readonly resourceUrls: readonly string[];
} {
  const tree = unified().use(remarkParse).parse(markdown) as MarkdownNode;
  const definitions = new Map<string, string>();
  traverse(tree, (node) => {
    if (node.type === "definition" && node.identifier && node.url) {
      definitions.set(node.identifier.toLowerCase(), node.url);
    }
  });
  let firstHeading: string | null = null;
  const resourceUrls: string[] = [];
  traverse(tree, (node) => {
    if (firstHeading === null && node.type === "heading") {
      const text: string[] = [];
      traverse(node, (child) => {
        if (child.type === "text" && child.value) text.push(child.value);
      });
      firstHeading = text.join("").normalize("NFC").slice(0, 500) || null;
    }
    if (node.type === "image" && node.url) resourceUrls.push(node.url);
    if (node.type === "imageReference" && node.identifier) {
      const url = definitions.get(node.identifier.toLowerCase());
      if (url) resourceUrls.push(url);
    }
  });
  return { firstHeading, resourceUrls };
}

async function localResourceExists(
  bundleRoot: string,
  rawUrl: string,
): Promise<boolean> {
  const withoutSuffix = rawUrl.split(/[?#]/u, 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutSuffix).normalize("NFC");
  } catch {
    return false;
  }
  if (
    !decoded ||
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.startsWith("/") ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(decoded)
  ) {
    return false;
  }
  const target = resolve(bundleRoot, decoded);
  const relation = relative(bundleRoot, target);
  if (
    relation === ".." ||
    relation.startsWith(`..${sep}`) ||
    relation.length === 0
  ) {
    return false;
  }
  try {
    const metadata = await lstat(target);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function companionConfidence(
  markdownPath: string,
  names: readonly string[],
): {
  readonly confidence: "generic" | "high";
  readonly reason: "cli-high-confidence" | "cloud-high-confidence" | null;
} {
  const name = basename(markdownPath).toLowerCase();
  const lowerNames = names.map((value) => value.toLowerCase());
  if (
    name === "full.md" &&
    (lowerNames.includes("layout.json") ||
      lowerNames.includes("content_list.json") ||
      lowerNames.some((value) => value.endsWith("_content_list.json")) ||
      lowerNames.includes("images"))
  ) {
    return { confidence: "high", reason: "cloud-high-confidence" };
  }
  const stem = name.slice(0, -3);
  const cliEvidence = lowerNames.some(
    (value) =>
      value === `${stem}_content_list.json` ||
      value === `${stem}_middle.json` ||
      value === `${stem}_model.json` ||
      value.startsWith(`${stem}_origin.`),
  );
  return cliEvidence
    ? { confidence: "high", reason: "cli-high-confidence" }
    : { confidence: "generic", reason: null };
}

export async function discoverMarkdownCandidates(
  rootInput: string,
  options: { readonly idFactory?: () => string } = {},
): Promise<CandidateDiscovery> {
  const root = resolve(rootInput);
  const markdownPaths = await walkMarkdown(root);
  const candidates: MarkdownCandidate[] = [];
  const highReasons = new Map<
    string,
    "cli-high-confidence" | "cloud-high-confidence"
  >();

  for (const markdownPath of markdownPaths) {
    const metadata = await lstat(markdownPath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size > maximumMarkdownBytes
    ) {
      continue;
    }
    const bytes = await readFile(markdownPath);
    let markdown: string;
    try {
      markdown = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      continue;
    }
    markdown = markdown.replace(/^\uFEFF/u, "");
    if (!markdown.trim()) continue;

    const directory = dirname(markdownPath);
    const siblingNames = (await readdir(directory)).sort((left, right) =>
      left.localeCompare(right, "en"),
    );
    const confidence = companionConfidence(markdownPath, siblingNames);
    const evidence = markdownEvidence(markdown);
    const missing = [];
    for (const url of evidence.resourceUrls) {
      if (!(await localResourceExists(directory, url))) missing.push(url);
    }
    const id = options.idFactory?.() ?? createOpaqueId("importCandidate");
    const diagnostics: CandidateDiagnostic[] =
      missing.length === 0
        ? []
        : [{ code: "RESOURCE_MISSING_OR_UNSAFE", severity: "error" }];
    const candidate = Object.freeze({
      byteSize: metadata.size,
      companionFiles: Object.freeze(
        siblingNames
          .filter((value) => value !== basename(markdownPath))
          .slice(0, 100),
      ),
      confidence: confidence.confidence,
      diagnostics: Object.freeze(diagnostics),
      firstHeading: evidence.firstHeading,
      id,
      normalizedPath: posixRelative(root, markdownPath),
      referencedResources: evidence.resourceUrls.length,
      score: confidence.confidence === "high" ? 100 : 50,
    });
    candidates.push(candidate);
    if (confidence.reason) highReasons.set(id, confidence.reason);
  }

  if (candidates.length === 0) {
    return Object.freeze({
      candidates: Object.freeze([]),
      decision: "reject",
      reason: "no-markdown",
      selectedCandidateId: null,
    });
  }
  const usable = candidates.filter(
    (candidate) =>
      !candidate.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      ),
  );
  if (usable.length === 0) {
    return Object.freeze({
      candidates: Object.freeze(candidates),
      decision: "reject",
      reason: "missing-resources",
      selectedCandidateId: null,
    });
  }
  if (usable.length === 1) {
    const candidate = usable[0];
    if (!candidate) throw new Error("Candidate selection invariant failed");
    const reason = highReasons.get(candidate.id);
    return Object.freeze({
      candidates: Object.freeze(candidates),
      decision: reason ? "automatic" : "confirmation",
      reason: reason ?? "generic-single-markdown",
      selectedCandidateId: candidate.id,
    });
  }

  const bundles = new Set(
    usable.map((candidate) => dirname(candidate.normalizedPath)),
  );
  return Object.freeze({
    candidates: Object.freeze(candidates),
    decision: "reject",
    reason: bundles.size > 1 ? "multiple-book-bundles" : "ambiguous-candidates",
    selectedCandidateId: null,
  });
}
