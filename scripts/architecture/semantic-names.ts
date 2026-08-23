import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const sourceExtensions = [".astro", ".js", ".mjs", ".ts", ".tsx"] as const;
const historicalIdentifier = /(?:V\d+|v\d+)$|^legacy(?:$|[A-Z_])/u;
const historicalFilename =
  /(?:^|[-_.])v\d+(?:[-_.]|$)|(?:^|[-_.])legacy(?:[-_.]|$)/iu;

export interface SemanticNameDiagnostic {
  readonly column: number;
  readonly line: number;
  readonly name: string;
  readonly path: string;
}

function scriptSource(
  path: string,
  source: string,
): { readonly offset: number; readonly script: string } {
  if (!path.endsWith(".astro") || !source.startsWith("---")) {
    return Object.freeze({ offset: 0, script: source });
  }
  const closing = source.indexOf("\n---", 3);
  return Object.freeze({
    offset: 3,
    script: closing < 0 ? source.slice(3) : source.slice(3, closing),
  });
}

function declarationName(node: ts.Node): ts.Identifier | undefined {
  if (
    ts.isClassDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.name && ts.isIdentifier(node.name) ? node.name : undefined;
  }
  return undefined;
}

export function inspectSemanticNames(input: {
  readonly path: string;
  readonly source: string;
}): readonly SemanticNameDiagnostic[] {
  const diagnostics: SemanticNameDiagnostic[] = [];
  if (historicalFilename.test(basename(input.path))) {
    diagnostics.push(
      Object.freeze({
        column: 1,
        line: 1,
        name: basename(input.path),
        path: input.path,
      }),
    );
  }
  const extracted = scriptSource(input.path, input.source);
  const kind = input.path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : input.path.endsWith(".js") || input.path.endsWith(".mjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    input.path,
    extracted.script,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const visit = (node: ts.Node): void => {
    const name = declarationName(node);
    if (name && historicalIdentifier.test(name.text)) {
      const location = file.getLineAndCharacterOfPosition(name.getStart(file));
      diagnostics.push(
        Object.freeze({
          column: location.character + 1,
          line: location.line + 1,
          name: name.text,
          path: input.path,
        }),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return Object.freeze(diagnostics);
}

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const output: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (
        entry.isFile() &&
        sourceExtensions.includes(
          extname(entry.name) as (typeof sourceExtensions)[number],
        )
      ) {
        output.push(path);
      }
    }
  }
  return Object.freeze(output.sort());
}

export async function analyzeSemanticNames(input: {
  readonly directories: readonly string[];
}): Promise<readonly SemanticNameDiagnostic[]> {
  const directories = input.directories.map((directory) => resolve(directory));
  const commonRoot = resolve(".");
  const files = (await Promise.all(directories.map(sourceFiles))).flat().sort();
  const diagnostics = await Promise.all(
    files.map(async (path) =>
      inspectSemanticNames({
        path: relative(commonRoot, path).split(sep).join("/"),
        source: await readFile(path, "utf8"),
      }),
    ),
  );
  return Object.freeze(diagnostics.flat());
}

async function main(): Promise<void> {
  const directories =
    process.argv.length > 2
      ? process.argv.slice(2)
      : ["src", "scripts/fixtures"];
  const diagnostics = await analyzeSemanticNames({ directories });
  process.stdout.write(`${JSON.stringify({ diagnostics }, null, 2)}\n`);
  if (diagnostics.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "SEMANTIC_NAME_CHECK_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
