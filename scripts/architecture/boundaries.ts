export const maximumDirectInternalDependencies = 12;
export const maximumInjectedPorts = 8;

export type ModuleLayer = "adapters" | "application" | "core";

export interface ModuleLocation {
  readonly domain: string;
  readonly layer: ModuleLayer;
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
      targetPath !== `modules/${target.domain}/application/public.ts`
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
  if (target && source.domain !== target.domain) {
    return targetPath === `modules/${target.domain}/application/public.ts`
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
