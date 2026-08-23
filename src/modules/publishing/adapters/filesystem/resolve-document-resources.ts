import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

import { createSafeDiagnostic, type SafeDiagnostic } from "@/domain/errors";
import { createOpaqueId } from "@/domain/ids";
import type {
  ParsedDocument,
  SourcePosition,
  TransientDocumentNode,
} from "../../core/preparation/document-model";
import type {
  ResolvedResource,
  ResolveDocumentResourcesOptions,
  ResourceReference,
  ResourceResolution,
} from "../../core/publication/resource-model";

function containedRelativePath(
  root: string,
  candidate: string,
): string | undefined {
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative.split(path.sep).join("/");
}

function safeDiagnostic(code: string, message: string): SafeDiagnostic {
  return createSafeDiagnostic({ code, message });
}

function stripQueryAndFragment(url: string): string {
  const query = url.indexOf("?");
  const fragment = url.indexOf("#");
  const end = [query, fragment]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), url.length);
  return url.slice(0, end);
}

function decodeLocalUrl(url: string): string | undefined {
  const stripped = stripQueryAndFragment(url);
  if (
    stripped.length === 0 ||
    stripped.includes("\\") ||
    stripped.includes("\0") ||
    stripped.startsWith("/") ||
    stripped.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/iu.test(stripped)
  ) {
    return undefined;
  }
  try {
    const decoded = decodeURIComponent(stripped).normalize("NFC");
    if (
      decoded.length === 0 ||
      decoded.includes("\\") ||
      decoded.includes("\0") ||
      decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      /^[a-z][a-z0-9+.-]*:/iu.test(decoded)
    ) {
      return undefined;
    }
    return decoded;
  } catch {
    return undefined;
  }
}

function collectImageUrls(
  document: ParsedDocument,
): readonly { readonly position?: SourcePosition; readonly url: string }[] {
  const definitions = new Map<string, string>();
  const imageNodes: TransientDocumentNode[] = [];
  const visit = (node: TransientDocumentNode) => {
    if (node.type === "definition" && node.identifier && node.url) {
      definitions.set(node.identifier.toUpperCase(), node.url);
    } else if (node.type === "image" || node.type === "imageReference") {
      imageNodes.push(node);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(document.root);
  return imageNodes.flatMap((node) => {
    const url =
      node.type === "image"
        ? node.url
        : node.identifier
          ? definitions.get(node.identifier.toUpperCase())
          : undefined;
    return url
      ? [{ ...(node.position ? { position: node.position } : {}), url }]
      : [];
  });
}

export async function resolveDocumentResources(
  options: ResolveDocumentResourcesOptions,
): Promise<ResourceResolution> {
  if (
    !path.isAbsolute(options.markdownPath) ||
    !path.isAbsolute(options.resourceRoot)
  ) {
    throw new TypeError("Resource root and Markdown path must be absolute");
  }
  const root = await realpath(options.resourceRoot);
  const markdown = await realpath(options.markdownPath);
  if (!containedRelativePath(root, markdown)) {
    throw new TypeError("Markdown path must be contained by the resource root");
  }
  const markdownDirectory = path.dirname(markdown);
  const resourcesByPath = new Map<string, ResolvedResource>();
  const diagnostics: SafeDiagnostic[] = [];
  const references: ResourceReference[] = [];

  const requests: {
    readonly baseDirectory: string;
    readonly createReference: boolean;
    readonly position?: SourcePosition;
    readonly url: string;
  }[] = [
    ...collectImageUrls(options.document).map((reference) => ({
      ...reference,
      baseDirectory: markdownDirectory,
      createReference: true,
    })),
    ...(options.additionalImagePaths ?? []).map((url) => ({
      baseDirectory: root,
      createReference: false,
      url,
    })),
  ];
  for (const reference of requests) {
    const decoded = decodeLocalUrl(reference.url);
    if (!decoded) {
      diagnostics.push(
        safeDiagnostic(
          "RESOURCE_URL_REJECTED",
          "An image uses an unsupported or unsafe resource URL.",
        ),
      );
      continue;
    }
    const lexicalPath = path.resolve(reference.baseDirectory, decoded);
    if (!containedRelativePath(root, lexicalPath)) {
      diagnostics.push(
        safeDiagnostic(
          "RESOURCE_OUTSIDE_ROOT",
          "An image resource resolves outside the accepted source bundle.",
        ),
      );
      continue;
    }
    let resolvedPath: string;
    try {
      const metadata = await lstat(lexicalPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        diagnostics.push(
          safeDiagnostic(
            "RESOURCE_NOT_REGULAR_FILE",
            "An image resource is not a regular file.",
          ),
        );
        continue;
      }
      resolvedPath = await realpath(lexicalPath);
    } catch {
      diagnostics.push(
        safeDiagnostic(
          "RESOURCE_MISSING",
          "A referenced image resource is missing.",
        ),
      );
      continue;
    }
    const relativePath = containedRelativePath(root, resolvedPath);
    if (!relativePath) {
      diagnostics.push(
        safeDiagnostic(
          "RESOURCE_OUTSIDE_ROOT",
          "An image resource resolves outside the accepted source bundle.",
        ),
      );
      continue;
    }
    let resource = resourcesByPath.get(resolvedPath);
    if (!resource) {
      resource = Object.freeze({
        absolutePath: resolvedPath,
        id: options.idFactory?.() ?? createOpaqueId("resource"),
        originalUrl: reference.url,
        relativePath,
      });
      resourcesByPath.set(resolvedPath, resource);
    }
    if (reference.createReference) {
      references.push(
        Object.freeze({
          originalUrl: reference.url,
          ...(reference.position ? { position: reference.position } : {}),
          resourceId: resource.id,
        }),
      );
    }
  }

  return Object.freeze({
    diagnostics: Object.freeze(diagnostics),
    references: Object.freeze(references),
    resources: Object.freeze([...resourcesByPath.values()]),
  });
}
