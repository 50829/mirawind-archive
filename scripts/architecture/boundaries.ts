import { posix } from "node:path";

export const maximumDirectInternalDependencies = 12;
export const maximumInjectedPorts = 8;

export type ModuleLayer = "adapters" | "application" | "core";

export interface ModuleLocation {
  readonly domain: string;
  readonly layer: ModuleLayer;
}

const sourceExtensions = [".astro", ".js", ".mjs", ".ts", ".tsx"] as const;

export function sourcePackage(path: string): string {
  const module = /^modules\/([^/]+)(?:\/|$)/u.exec(path);
  if (module?.[1]) return `modules/${module[1]}`;
  const separator = path.indexOf("/");
  return separator < 0 ? "src-root" : path.slice(0, separator);
}

export function applicationApiPath(domain: string): string {
  return `modules/${domain}/application/${domain}-api.ts`;
}

export function canonicalInternalSpecifier(
  sourcePath: string,
  targetPath: string,
): string {
  const extension = posix.extname(targetPath);
  const importPath =
    extension === ".astro" ||
    extension === ".css" ||
    !sourceExtensions.includes(extension as (typeof sourceExtensions)[number])
      ? targetPath
      : targetPath.slice(0, -extension.length);
  if (sourcePackage(sourcePath) !== sourcePackage(targetPath)) {
    return `@/${importPath}`;
  }
  const local = posix.relative(posix.dirname(sourcePath), importPath);
  return local.startsWith(".") ? local : `./${local}`;
}

export function moduleLocation(path: string): ModuleLocation | null {
  const match = /^modules\/([^/]+)\/(core|application|adapters)(?:\/|$)/u.exec(
    path,
  );
  if (!match?.[1] || !match[2]) return null;
  return Object.freeze({
    domain: match[1],
    layer: match[2] as ModuleLayer,
  });
}

export function isCompositionRoot(path: string): boolean {
  return path.startsWith("composition/");
}

export function isApplicationPort(path: string): boolean {
  return /^modules\/[^/]+\/application\/ports\//u.test(path);
}

export function dependencyViolation(
  sourcePath: string,
  targetPath: string,
): "CROSS_MODULE_DEEP_IMPORT" | "FORBIDDEN_DEPENDENCY" | null {
  const source = moduleLocation(sourcePath);
  const target = moduleLocation(targetPath);
  if (!source) {
    if (
      /^(?:entrypoints|pages|web)\//u.test(sourcePath) &&
      target !== null &&
      targetPath !== applicationApiPath(target.domain)
    ) {
      return "FORBIDDEN_DEPENDENCY";
    }
    if (
      sourcePath.startsWith("platform/") &&
      (target !== null ||
        targetPath.startsWith("web/") ||
        targetPath.startsWith("entrypoints/"))
    ) {
      return "FORBIDDEN_DEPENDENCY";
    }
    return null;
  }
  if (
    source.layer === "core" &&
    !targetPath.startsWith("domain/") &&
    !(
      target !== null &&
      source.domain === target.domain &&
      target.layer === "core"
    )
  ) {
    return "FORBIDDEN_DEPENDENCY";
  }
  if (target && source.domain !== target.domain) {
    return targetPath === applicationApiPath(target.domain)
      ? null
      : "CROSS_MODULE_DEEP_IMPORT";
  }
  if (!target || source.domain !== target.domain) return null;
  if (
    source.layer === "core" &&
    (target.layer === "application" || target.layer === "adapters")
  ) {
    return "FORBIDDEN_DEPENDENCY";
  }
  if (source.layer === "application" && target.layer === "adapters") {
    return "FORBIDDEN_DEPENDENCY";
  }
  return null;
}
