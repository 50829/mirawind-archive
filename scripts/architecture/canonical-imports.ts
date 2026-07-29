import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const parsedExtensions = [".ts", ".tsx", ".astro", ".js", ".mjs"] as const;
const resolvedExtensions = [...parsedExtensions, ".css"] as const;

interface SpecifierLocation {
  readonly end: number;
  readonly specifier: string;
  readonly start: number;
}

async function filesBelow(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) break;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (
        entry.isFile() &&
        resolvedExtensions.includes(
          extname(entry.name) as (typeof resolvedExtensions)[number],
        )
      ) {
        files.push(path);
      }
    }
  }
  return Object.freeze(files.sort());
}

function scriptSource(
  path: string,
  source: string,
): {
  readonly offset: number;
  readonly script: string;
} {
  if (!path.endsWith(".astro") || !source.startsWith("---")) {
    return Object.freeze({ offset: 0, script: source });
  }
  const closing = source.indexOf("\n---", 3);
  return Object.freeze({
    offset: 3,
    script: closing < 0 ? source.slice(3) : source.slice(3, closing),
  });
}

function specifiers(
  path: string,
  source: string,
): readonly SpecifierLocation[] {
  const extracted = scriptSource(path, source);
  const kind = path.endsWith(".tsx")
    ? ts.ScriptKind.TSX
    : path.endsWith(".js") || path.endsWith(".mjs")
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS;
  const file = ts.createSourceFile(
    path,
    extracted.script,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const output: SpecifierLocation[] = [];
  const add = (value: ts.Expression | undefined): void => {
    if (!value || !ts.isStringLiteralLike(value)) return;
    output.push(
      Object.freeze({
        end: extracted.offset + value.getEnd() - 1,
        specifier: value.text,
        start: extracted.offset + value.getStart(file) + 1,
      }),
    );
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
  return Object.freeze(output);
}

function candidatePaths(base: string): readonly string[] {
  const extension = extname(base);
  const withoutJavaScript = /\.[cm]?js$/u.test(extension)
    ? base.slice(0, -extension.length)
    : base;
  const exact = extension && !/\.[cm]?js$/u.test(extension) ? [base] : [];
  return Object.freeze([
    ...exact,
    ...resolvedExtensions.map(
      (candidate) => `${withoutJavaScript}${candidate}`,
    ),
    ...resolvedExtensions.map((candidate) =>
      join(withoutJavaScript, `index${candidate}`),
    ),
  ]);
}

function aliasFor(target: string, sourceDirectory: string): string {
  const extension = extname(target);
  const sourcePath = relative(sourceDirectory, target).split(sep).join("/");
  const suffix =
    extension === ".css" ? sourcePath : sourcePath.slice(0, -extension.length);
  return `@/${suffix}`;
}

export async function canonicalizeInternalImports(input: {
  readonly sourceDirectory: string;
  readonly write: boolean;
}): Promise<
  readonly { readonly file: string; readonly replacements: number }[]
> {
  const sourceDirectory = resolve(input.sourceDirectory);
  const allFiles = await filesBelow(sourceDirectory);
  const fileSet = new Set(allFiles);
  const changed: { file: string; replacements: number }[] = [];
  for (const file of allFiles) {
    if (
      !parsedExtensions.includes(
        extname(file) as (typeof parsedExtensions)[number],
      )
    ) {
      continue;
    }
    const source = await readFile(file, "utf8");
    const replacements = specifiers(file, source)
      .flatMap((location) => {
        if (!location.specifier.startsWith(".")) return [];
        const base = resolve(dirname(file), location.specifier);
        const target = candidatePaths(base).find((candidate) =>
          fileSet.has(candidate),
        );
        if (!target) return [];
        return [
          Object.freeze({
            ...location,
            alias: aliasFor(target, sourceDirectory),
          }),
        ];
      })
      .toSorted((left, right) => right.start - left.start);
    if (replacements.length === 0) continue;
    let output = source;
    for (const replacement of replacements) {
      output = `${output.slice(0, replacement.start)}${replacement.alias}${output.slice(replacement.end)}`;
    }
    if (input.write) await writeFile(file, output);
    changed.push(
      Object.freeze({
        file: relative(sourceDirectory, file).split(sep).join("/"),
        replacements: replacements.length,
      }),
    );
  }
  return Object.freeze(changed);
}

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const changed = await canonicalizeInternalImports({
    sourceDirectory: resolve("src"),
    write,
  });
  process.stdout.write(
    `${JSON.stringify({ files: changed.length, replacements: changed.reduce((total, item) => total + item.replacements, 0), write })}\n`,
  );
  if (!write && changed.length > 0) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "CANONICAL_IMPORTS_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
