import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  hiddenManagementPage,
  redirectToAdministratorLogin,
} from "@/http/authorization/manage-page";
import { authorizeBookResource } from "@/http/authorization/book-guard";
import {
  responsePolicyFor,
  type ResponsePolicyKind,
} from "@/http/cache/policies";
import {
  immutableAssetHeaders,
  readingPageHeaders,
} from "@/http/cache/reading-response";
import {
  libraryHtmlResponse,
  publicJsonResponse,
} from "@/http/cache/library-response";
import {
  createSafeHtmlError,
  createSafeJsonError,
} from "@/http/errors/responses";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pagesRoot = fileURLToPath(new URL("../../../src/pages", import.meta.url));
const noIndex = "noindex, nofollow, noarchive, nosnippet";

const responseMatrix: readonly {
  readonly cacheControl: string;
  readonly name: string;
  readonly policy: ResponsePolicyKind;
  readonly robotsTag?: string;
}[] = [
  {
    cacheControl: "private, no-store",
    name: "login page and authenticated login redirect",
    policy: "login",
    robotsTag: noIndex,
  },
  {
    cacheControl: "private, no-store",
    name: "management HTML and anonymous login redirect",
    policy: "manage",
    robotsTag: noIndex,
  },
  {
    cacheControl: "private, no-store",
    name: "draft preview HTML and assets",
    policy: "draft",
    robotsTag: noIndex,
  },
  {
    cacheControl: "private, no-store",
    name: "management and private APIs",
    policy: "private-api",
    robotsTag: noIndex,
  },
  {
    cacheControl: "private, no-store",
    name: "private reader HTML, assets and search",
    policy: "private",
    robotsTag: noIndex,
  },
  {
    cacheControl: "public, max-age=0, must-revalidate",
    name: "public library, details, reader HTML and JSON",
    policy: "public-html",
  },
  {
    cacheControl: "private, max-age=31536000, immutable",
    name: "public version-pinned reading assets",
    policy: "public-versioned-resource",
  },
  {
    cacheControl: "private, no-store",
    name: "authorized original downloads and ranges",
    policy: "original-download",
    robotsTag: noIndex,
  },
  {
    cacheControl: "no-store",
    name: "canonical reader redirects",
    policy: "redirect",
    robotsTag: noIndex,
  },
  {
    cacheControl: "no-store",
    name: "missing and hidden pages, assets, APIs and downloads",
    policy: "hidden-or-missing",
    robotsTag: noIndex,
  },
];

const routePolicyEvidence: Readonly<Record<string, readonly string[]>> = {
  "api/auth/[...all].ts": ['headers.set("Cache-Control"'],
  "api/books/[bookKey]/details.ts": [
    "publicJsonResponse",
    "applyResponsePolicy",
  ],
  "api/books/[bookKey]/search.ts": ["applyResponsePolicy"],
  "api/manage/books/[bookId].ts": [
    "requireRuntimeAdministrator",
    "requireMutationOrigin",
    'applyResponsePolicy(headers, "private-api")',
  ],
  "api/manage/library.ts": ['applyResponsePolicy(headers, "private-api")'],
  "api/manage/books/[bookId]/draft.ts": ["applyResponsePolicy"],
  "api/manage/books/[bookId]/preview/[configRevision]/assets/[resourceId].ts": [
    "applyResponsePolicy",
  ],
  "api/manage/books/[bookId]/preview/[configRevision]/pages/[pageId].ts": [
    "applyResponsePolicy",
  ],
  "api/manage/books/[bookId]/publish.ts": ["applyResponsePolicy"],
  "api/manage/books/[bookId]/reprocess.ts": ["applyResponsePolicy"],
  "api/manage/books/[bookId]/visibility.ts": ["applyResponsePolicy"],
  "api/manage/health.ts": ["applyResponsePolicy"],
  "api/manage/imports/[importId]/index.ts": ["applyResponsePolicy"],
  "api/manage/imports/[importId]/main-markdown.ts": ["applyResponsePolicy"],
  "api/manage/imports/index.ts": ["applyResponsePolicy"],
  "api/manage/jobs/[jobId]/cancel.ts": ["applyResponsePolicy"],
  "api/manage/jobs/[jobId]/index.ts": ["applyResponsePolicy"],
  "api/manage/jobs/[jobId]/retry.ts": ["applyResponsePolicy"],
  "api/manage/security/passkeys/[passkeyId]/delete-final.ts": [
    "cachePolicyFor",
    "createSafeJsonError",
  ],
  "books/[bookKey]/assets/[versionId]/[resourceId].ts": [
    "immutableAssetHeaders",
  ],
  "books/[bookKey]/index.astro": ["libraryHtmlResponse", "applyResponsePolicy"],
  "books/[bookKey]/originals/[fileId].ts": ["applyResponsePolicy"],
  "library/index.astro": ["libraryHtmlResponse"],
  "login.astro": ["applyResponsePolicy"],
  "manage/books/[bookId]/preview.astro": [
    "hiddenManagementPage",
    "applyResponsePolicy",
  ],
  "manage/index.astro": [
    "redirectToAdministratorLogin",
    "hiddenManagementPage",
    "applyResponsePolicy",
  ],
  "manage/security.astro": [
    "redirectToAdministratorLogin",
    "hiddenManagementPage",
    "applyResponsePolicy",
  ],
  "manage/tasks.astro": [
    "redirectToAdministratorLogin",
    "hiddenManagementPage",
    "applyResponsePolicy",
  ],
  "read/[bookKey]/[pageKey].ts": ["readingPageHeaders", "applyResponsePolicy"],
  "read/[bookKey]/index.ts": ["applyResponsePolicy"],
};

async function routeFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await routeFiles(`${directory}/${entry.name}`, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files.sort();
}

describe("full route authorization, cache and indexing matrix", () => {
  it("freezes every response class used by login, management and book routes", () => {
    for (const row of responseMatrix) {
      expect(responsePolicyFor(row.policy), row.name).toEqual({
        cacheControl: row.cacheControl,
        ...(row.robotsTag ? { robotsTag: row.robotsTag } : {}),
      });
    }
  });

  it("covers redirects, errors and public/private representations with real header builders", async () => {
    const loginRedirect = redirectToAdministratorLogin("/manage/tasks");
    expect(loginRedirect.status).toBe(303);
    expect(loginRedirect.headers.get("location")).toBe(
      "/login?next=%2Fmanage%2Ftasks",
    );
    expect(loginRedirect.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(loginRedirect.headers.get("x-robots-tag")).toBe(noIndex);

    const hiddenManage = hiddenManagementPage();
    expect(hiddenManage.status).toBe(404);
    expect(hiddenManage.headers.get("cache-control")).toBe("no-store");
    expect(hiddenManage.headers.get("x-robots-tag")).toBe(noIndex);

    for (const status of [401, 403] as const) {
      const error = createSafeJsonError({
        code: status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN",
        message: "Request denied.",
        policy: "private-api",
        requestId: "req_route_matrix",
        status,
      });
      expect(error.headers.get("cache-control")).toBe("private, no-store");
      expect(error.headers.get("x-robots-tag")).toBe(noIndex);
      expect(error.headers.get("x-content-type-options")).toBe("nosniff");
    }

    const hidden = createSafeHtmlError({
      code: "NOT_FOUND",
      message: "Not found.",
      policy: "hidden-or-missing",
      requestId: "req_route_matrix",
      status: 404,
    });
    expect(hidden.headers.get("cache-control")).toBe("no-store");
    expect(hidden.headers.get("x-robots-tag")).toBe(noIndex);

    expect(
      readingPageHeaders({
        pageIdentity: "1",
        rendererVersion: "renderer-v1",
        requestPath: "/read/book/page",
        versionId: "ver_route_matrix_0000000001",
        visibility: "public",
      }).headers.get("cache-control"),
    ).toBe("public, max-age=0, must-revalidate");
    expect(
      readingPageHeaders({
        pageIdentity: "1",
        rendererVersion: "renderer-v1",
        requestPath: "/read/book/page",
        versionId: "ver_route_matrix_0000000001",
        visibility: "private",
      }).headers.get("cache-control"),
    ).toBe("private, no-store");
    const library = libraryHtmlResponse({
      digest: "route-matrix",
      rendererIdentity: "library-v1",
      request: new Request("https://library.example/library"),
      requestPath: "/library",
      visibility: "public",
    });
    expect(library.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(library.headers.get("x-robots-tag")).toBeNull();
    const detailsJson = publicJsonResponse({
      digest: "route-matrix",
      rendererIdentity: "details-json-v1",
      request: new Request("https://library.example/api/books/book/details"),
      requestPath: "/api/books/book/details",
    });
    expect(detailsJson.headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(detailsJson.headers.get("x-robots-tag")).toBe(noIndex);
    expect(
      immutableAssetHeaders({
        mediaType: "image/png",
        sha256: "a".repeat(64),
        sizeBytes: 1,
        visibility: "public",
      }).headers.get("cache-control"),
    ).toBe("private, max-age=31536000, immutable");
    expect(
      immutableAssetHeaders({
        mediaType: "image/png",
        sha256: "a".repeat(64),
        sizeBytes: 1,
        visibility: "private",
      }).headers.get("cache-control"),
    ).toBe("private, no-store");
  });

  it("makes anonymous private books indistinguishable from missing books across representations", () => {
    const anonymous = {
      allowed: false,
      reason: "UNAUTHENTICATED",
    } as const;
    const hidden = authorizeBookResource({
      administrator: anonymous,
      exists: true,
      visibility: "private",
    });
    const missing = authorizeBookResource({
      administrator: anonymous,
      exists: false,
    });
    expect(hidden).toEqual(missing);
    expect(hidden).toMatchObject({
      allowed: false,
      cacheControl: "no-store",
      representation: "hidden-or-missing",
      status: 404,
    });
    expect(
      authorizeBookResource({
        administrator: { allowed: true },
        exists: true,
        versionState: "published",
        visibility: "private",
      }),
    ).toMatchObject({
      allowed: true,
      audience: "administrator",
    });
    expect(responsePolicyFor("private").cacheControl).toBe("private, no-store");
  });

  it("registers explicit policy evidence for every M1 page module", async () => {
    const discovered = (await routeFiles(pagesRoot)).filter(
      (path) => path !== "index.astro",
    );
    expect(Object.keys(routePolicyEvidence).sort()).toEqual(discovered);
    for (const [path, evidence] of Object.entries(routePolicyEvidence)) {
      const source = await readFile(`${projectRoot}src/pages/${path}`, "utf8");
      for (const marker of evidence) {
        expect(source, `${path} must declare ${marker}`).toContain(marker);
      }
    }
  });
});
