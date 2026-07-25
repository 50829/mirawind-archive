import { readFile, readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const sourceRoot = resolve(projectRoot, "src");
const checkedExtensions = new Set([
  ".astro",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
]);
const directColor =
  /#[\da-f]{3,8}\b|(?:^|[^\w-])(?:rgb|rgba|hsl|hsla|oklch|lab|lch)\s*\(/giu;
const parallelColorToken =
  /--(?!color-)[a-z0-9-]*(?:accent|background|border|color|foreground|muted|surface)[a-z0-9-]*\s*:/giu;

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile() && checkedExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }
  return files;
}

const failures = [];
for (const path of await filesUnder(sourceRoot)) {
  const source = await readFile(path, "utf8");
  for (const [rule, pattern] of [
    ["direct color literal", directColor],
    ["parallel color token", parallelColorToken],
  ]) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const offset = match.index ?? 0;
      const line = source.slice(0, offset).split("\n").length;
      failures.push(
        `${path.slice(projectRoot.length + 1)}:${line}: ${rule}: ${match[0].trim()}`,
      );
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(
    [
      "Product UI colors must use approved Tailwind utilities or --color-* tokens.",
      ...failures,
      "",
    ].join("\n"),
  );
  process.exitCode = 1;
}
