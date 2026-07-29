import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  dependencyViolation,
  isApplicationPort,
  isCompositionRoot,
  maximumDirectInternalDependencies,
  maximumInjectedPorts,
  moduleLocation,
} from "./boundaries.js";

const sourceExtensions = [
  ".ts",
  ".tsx",
  ".astro",
  ".js",
  ".mjs",
  ".css",
] as const;

export type ArchitectureDiagnosticCode =
  | "CROSS_MODULE_DEEP_IMPORT"
  | "DEPENDENCY_CYCLE"
  | "DIRECT_INTERNAL_DEPENDENCY_LIMIT"
  | "FORBIDDEN_DEPENDENCY"
  | "INJECTED_PORT_LIMIT"
  | "NON_CANONICAL_IMPORT"
  | "UNRESOLVED_INTERNAL_IMPORT";

export interface ArchitectureDiagnostic {
  readonly code: ArchitectureDiagnosticCode;
  readonly path: readonly string[];
  readonly source: string;
  readonly specifier: string | null;
  readonly target: string | null;
}

export interface DependencyGraphResult {
  readonly diagnostics: readonly ArchitectureDiagnostic[];
  readonly edges: ReadonlyMap<string, readonly string[]>;
  readonly files: readonly string[];
}

interface ImportReference {
  readonly specifier: string;
}

function normalizedPath(path: string): string {
  return path.split(sep).join("/");
}

async function sourceFiles(root: string): Promise<readonly string[]> {
  const output: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (
        entry.isFile() &&
        sourceExtensions.includes(
          extname(entry.name) as (typeof sourceExtensions)[number],
        ) &&
        !entry.name.endsWith(".d.ts")
      ) {
        output.push(path);
      }
    }
  }
  return Object.freeze(output.sort());
}

function astroScript(source: string): string {
  if (!source.startsWith("---")) return source;
  const closing = source.indexOf("\n---", 3);
  return closing < 0 ? source : source.slice(3, closing);
}

function importsFor(path: string, source: string): readonly ImportReference[] {
  const script = path.endsWith(".astro") ? astroScript(source) : source;
  const kind = path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : path.endsWith(".js") || path.endsWith(".mjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    path,
    script,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const imports: ImportReference[] = [];
  const add = (value: ts.Expression | undefined): void => {
    if (value && ts.isStringLiteralLike(value)) {
      imports.push(Object.freeze({ specifier: value.text }));
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add(node.arguments[0]);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return Object.freeze(imports);
}

function candidatePaths(base: string): readonly string[] {
  const extension = extname(base);
  const withoutJavaScript = /\.[cm]?js$/u.test(extension)
    ? base.slice(0, -extension.length)
    : base;
  const candidates = extension && !/\.[cm]?js$/u.test(extension) ? [base] : [];
  return Object.freeze([
    ...candidates,
    ...sourceExtensions.map((candidate) => `${withoutJavaScript}${candidate}`),
    ...sourceExtensions.map((candidate) =>
      join(withoutJavaScript, `index${candidate}`),
    ),
  ]);
}

function resolveInternalImport(input: {
  readonly files: ReadonlySet<string>;
  readonly sourceDirectory: string;
  readonly sourceFile: string;
  readonly specifier: string;
}): string | null {
  const base = input.specifier.startsWith("@/")
    ? join(input.sourceDirectory, input.specifier.slice(2))
    : input.specifier.startsWith(".")
      ? resolve(dirname(input.sourceFile), input.specifier)
      : null;
  if (!base) return null;
  return (
    candidatePaths(base).find((candidate) => input.files.has(candidate)) ?? null
  );
}

function stronglyConnectedComponents(
  files: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): readonly (readonly string[])[] {
  let index = 0;
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const indexedValue = (values: ReadonlyMap<string, number>, file: string) => {
    const value = values.get(file);
    if (value === undefined)
      throw new Error("ARCHITECTURE_GRAPH_INDEX_MISSING");
    return value;
  };
  const connect = (file: string): void => {
    indexes.set(file, index);
    lowLinks.set(file, index);
    index += 1;
    stack.push(file);
    onStack.add(file);
    for (const target of edges.get(file) ?? []) {
      if (!indexes.has(target)) {
        connect(target);
        lowLinks.set(
          file,
          Math.min(
            indexedValue(lowLinks, file),
            indexedValue(lowLinks, target),
          ),
        );
      } else if (onStack.has(target)) {
        lowLinks.set(
          file,
          Math.min(indexedValue(lowLinks, file), indexedValue(indexes, target)),
        );
      }
    }
    if (lowLinks.get(file) !== indexes.get(file)) return;
    const component: string[] = [];
    while (stack.length > 0) {
      const target = stack.pop();
      if (!target) break;
      onStack.delete(target);
      component.push(target);
      if (target === file) break;
    }
    components.push(component.sort());
  };
  for (const file of files) if (!indexes.has(file)) connect(file);
  return Object.freeze(components.map((component) => Object.freeze(component)));
}

function cyclePath(
  component: readonly string[],
  edges: ReadonlyMap<string, readonly string[]>,
): readonly string[] {
  const members = new Set(component);
  const start = component[0];
  if (!start) return Object.freeze([]);
  const search = (
    current: string,
    path: readonly string[],
  ): readonly string[] | null => {
    for (const target of edges.get(current) ?? []) {
      if (!members.has(target)) continue;
      if (target === start) return Object.freeze([...path, start]);
      if (!path.includes(target)) {
        const found = search(target, [...path, target]);
        if (found) return found;
      }
    }
    return null;
  };
  return search(start, [start]) ?? Object.freeze(component);
}

function diagnostic(
  code: ArchitectureDiagnosticCode,
  source: string,
  target: string | null,
  specifier: string | null,
  path: readonly string[] = target ? [source, target] : [source],
): ArchitectureDiagnostic {
  return Object.freeze({
    code,
    path: Object.freeze([...path]),
    source,
    specifier,
    target,
  });
}

export async function analyzeDependencyGraph(input: {
  readonly sourceDirectory: string;
}): Promise<DependencyGraphResult> {
  const sourceDirectory = resolve(input.sourceDirectory);
  const absoluteFiles = await sourceFiles(sourceDirectory);
  const fileSet = new Set(absoluteFiles);
  const relativePath = (path: string) =>
    normalizedPath(relative(sourceDirectory, path));
  const edges = new Map<string, string[]>();
  const diagnostics: ArchitectureDiagnostic[] = [];
  for (const sourceFile of absoluteFiles) {
    const source = relativePath(sourceFile);
    const imports = importsFor(sourceFile, await readFile(sourceFile, "utf8"));
    const targets = new Set<string>();
    for (const imported of imports) {
      if (
        !imported.specifier.startsWith("@/") &&
        !imported.specifier.startsWith(".")
      ) {
        continue;
      }
      const targetFile = resolveInternalImport({
        files: fileSet,
        sourceDirectory,
        sourceFile,
        specifier: imported.specifier,
      });
      if (!targetFile) {
        if (imported.specifier.startsWith("@/")) {
          diagnostics.push(
            diagnostic(
              "UNRESOLVED_INTERNAL_IMPORT",
              source,
              null,
              imported.specifier,
            ),
          );
        }
        continue;
      }
      const target = relativePath(targetFile);
      targets.add(target);
      if (imported.specifier.startsWith(".")) {
        diagnostics.push(
          diagnostic(
            "NON_CANONICAL_IMPORT",
            source,
            target,
            imported.specifier,
          ),
        );
      }
      const violation = dependencyViolation(source, target);
      if (violation)
        diagnostics.push(
          diagnostic(violation, source, target, imported.specifier),
        );
    }
    const orderedTargets = [...targets].sort();
    edges.set(source, orderedTargets);
    if (
      !isCompositionRoot(source) &&
      orderedTargets.length > maximumDirectInternalDependencies
    ) {
      diagnostics.push(
        diagnostic("DIRECT_INTERNAL_DEPENDENCY_LIMIT", source, null, null),
      );
    }
    const location = moduleLocation(source);
    if (location?.layer === "application") {
      const ports = orderedTargets.filter(isApplicationPort);
      if (ports.length > maximumInjectedPorts) {
        diagnostics.push(diagnostic("INJECTED_PORT_LIMIT", source, null, null));
      }
    }
  }
  const relativeFiles = absoluteFiles.map(relativePath);
  for (const component of stronglyConnectedComponents(relativeFiles, edges)) {
    const selfCycle =
      component.length === 1 &&
      (edges.get(component[0] ?? "") ?? []).includes(component[0] ?? "");
    if (component.length > 1 || selfCycle) {
      const source = component[0] ?? "unknown";
      diagnostics.push(
        diagnostic(
          "DEPENDENCY_CYCLE",
          source,
          source,
          null,
          cyclePath(component, edges),
        ),
      );
    }
  }
  diagnostics.sort((left, right) =>
    `${left.code}:${left.source}:${left.target ?? ""}`.localeCompare(
      `${right.code}:${right.source}:${right.target ?? ""}`,
    ),
  );
  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    edges: new Map(
      [...edges.entries()].map(([source, targets]) => [
        source,
        Object.freeze(targets),
      ]),
    ),
    files: Object.freeze(relativeFiles),
  });
}

async function main(): Promise<void> {
  const sourceDirectory = resolve(process.argv[2] ?? "src");
  const result = await analyzeDependencyGraph({ sourceDirectory });
  process.stdout.write(
    `${JSON.stringify({ diagnostics: result.diagnostics, file_count: result.files.length }, null, 2)}\n`,
  );
  if (result.diagnostics.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "ARCHITECTURE_GRAPH_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
