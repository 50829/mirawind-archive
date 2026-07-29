import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import * as catalog from "@/modules/catalog/application/public";
import type {
  BookDetails,
  PublicLibraryView,
} from "@/modules/catalog/application/public";
import * as identity from "@/modules/identity/application/public";
import type { RequestSession } from "@/modules/identity/application/public";
import * as publishing from "@/modules/publishing/application/public";
import type {
  BookVersionRecord,
  JobKind,
} from "@/modules/publishing/application/public";
import * as reader from "@/modules/reader/application/public";
import type {
  ReaderPageModel,
  ReaderTocNode,
} from "@/modules/reader/application/public";

const sourceRoot = fileURLToPath(new URL("../../src", import.meta.url));
const modulesRoot = fileURLToPath(
  new URL("../../src/modules", import.meta.url),
);

async function sourceFiles(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(path);
      return entry.isFile() && /\.(?:astro|ts|tsx)$/u.test(entry.name)
        ? [path]
        : [];
    }),
  );
  return nested.flat();
}

describe("module application public surfaces", () => {
  it("exposes the stable runtime entrypoints", () => {
    expect(Object.keys(publishing).sort()).toEqual([
      "candidateBuildIdentities",
      "canonicalJson",
      "evaluateJobRetry",
      "importUploadIdempotencyOperation",
      "isKnownJobPhase",
      "jobKinds",
      "katexCriticalCss",
      "m1ImportExpiryMs",
      "m1PublishPolicy",
      "maximumUploadBytes",
      "parseBookConfigYaml",
      "parseBuildCandidateCommand",
      "parseCandidateBuildArtifact",
      "publishingRendererIdentity",
      "rendererStylesheetUrl",
      "validateBookConfig",
      "validateDocumentManifest",
    ]);
    expect(Object.keys(reader).sort()).toEqual([
      "acceptedReaderAssetPath",
      "buildReaderNavigationTree",
      "normalizeSearchQuery",
      "readerAssetIdentity",
      "readerBreadcrumbs",
      "readerRendererAssets",
      "readerScriptUrl",
      "readerStylesheetUrl",
    ]);
    expect(Object.keys(catalog)).toEqual(["deriveBookVersionPresentation"]);
    expect(Object.keys(identity)).toEqual(["authorizePasskeyMutation"]);
  });

  it("exposes the stable cross-module DTO types", () => {
    expectTypeOf<BookVersionRecord>().toBeObject();
    expectTypeOf<JobKind>().toEqualTypeOf<
      | "analyze_import"
      | "prepare_draft"
      | "build_preview"
      | "build_publish"
      | "verify_version"
      | "reconcile"
      | "reclaim"
    >();
    expectTypeOf<ReaderPageModel>().toBeObject();
    expectTypeOf<ReaderTocNode>().toBeObject();
    expectTypeOf<PublicLibraryView>().toBeObject();
    expectTypeOf<BookDetails>().toBeObject();
    expectTypeOf<RequestSession>().toBeObject();
  });

  it("keeps adapters out of public surfaces and deep imports out of peers", async () => {
    const publicSurfaces = await Promise.all(
      ["catalog", "identity", "publishing", "reader"].map(async (module) => {
        const path = `${modulesRoot}/${module}/application/public.ts`;
        return { module, source: await readFile(path, "utf8") };
      }),
    );
    for (const surface of publicSurfaces) {
      expect(surface.source, surface.module).not.toMatch(
        /@\/modules\/[^/]+\/adapters\//u,
      );
    }

    const violations: string[] = [];
    for (const path of await sourceFiles(modulesRoot)) {
      const owner = path.slice(modulesRoot.length + 1).split("/")[0];
      const source = await readFile(path, "utf8");
      for (const match of source.matchAll(
        /["']@\/modules\/([^/]+)\/([^"']+)["']/gu,
      )) {
        const [, target, targetPath] = match;
        if (target !== owner && targetPath !== "application/public") {
          violations.push(
            `${path.slice(sourceRoot.length + 1)} -> ${match[0]}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
