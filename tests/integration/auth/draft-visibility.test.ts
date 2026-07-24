import { describe, expect, it } from "vitest";

import { closeRuntimeAuthForTests } from "@/auth/session";
import { DraftRepository } from "@/db/repositories/drafts";
import { ImportRepository } from "@/db/repositories/imports";
import { InstallationRepository } from "@/db/repositories/installation";
import { JobRepository } from "@/db/repositories/jobs";
import {
  createSafeJsonError,
  safeErrorInputFromUnknown,
} from "@/http/errors/responses";
import { errorPolicyForRequest } from "@/http/errors/error-policy";
import { m1ImportExpiryMs } from "@/services/import-upload";
import { resetRuntimeStorageForTests } from "@/storage/runtime";

import { GET as getDraft } from "../../../src/pages/api/manage/books/[bookId]/draft.js";
import { GET as getPreviewAsset } from "../../../src/pages/api/manage/books/[bookId]/preview/[configRevision]/assets/[resourceId].js";
import { GET as getPreviewPage } from "../../../src/pages/api/manage/books/[bookId]/preview/[configRevision]/pages/[pageId].js";
import { GET as getImport } from "../../../src/pages/api/manage/imports/[importId]/index.js";
import { GET as getJob } from "../../../src/pages/api/manage/jobs/[jobId]/index.js";
import { createTemporaryDataRoot } from "../../helpers/data-root.js";
import { openMigratedTestDatabase } from "../../helpers/database.js";

const environmentKeys = [
  "MIRAWIND_ALLOWED_HOSTS",
  "MIRAWIND_AUTH_SECRET",
  "MIRAWIND_DATA_DIR",
  "MIRAWIND_PASSKEY_RP_ID",
  "MIRAWIND_PUBLIC_ORIGIN",
] as const;

type RouteHandler = (context: never) => unknown;

async function hiddenResponse(
  handler: RouteHandler,
  path: string,
  params: Readonly<Record<string, string>>,
): Promise<Response> {
  try {
    await handler({
      locals: { session: null },
      params,
    } as never);
  } catch (cause) {
    const safe = safeErrorInputFromUnknown({
      cause,
      policy: errorPolicyForRequest(path, 404),
      requestId: "req_visibility_test",
    });
    return createSafeJsonError(safe);
  }
  throw new Error("Anonymous private route unexpectedly returned a response");
}

describe("draft resource visibility", () => {
  it("makes existing and missing candidates, tasks, sources, diagnostics, pages and assets indistinguishable", async () => {
    const previous = Object.fromEntries(
      environmentKeys.map((key) => [key, process.env[key]]),
    );
    const dataRoot = await createTemporaryDataRoot("draft-visibility");
    const migrated = await openMigratedTestDatabase(dataRoot);
    let importedId: string;
    let jobId: string;
    let bookId: number;
    try {
      new InstallationRepository(migrated.database).ensure(1);
      const book = new DraftRepository(migrated.database).createBook({
        nowMs: 1,
        title: "Private test book",
      });
      bookId = book.id;
      const imported = new ImportRepository(migrated.database).createUploaded({
        bookId,
        expiresAtMs: m1ImportExpiryMs,
        id: "imp_0123456789abcdefghij",
        nowMs: 1,
        uploadRelativePath: "tmp/uploads/private/original.zip",
        uploadSha256: "a".repeat(64),
        uploadSizeBytes: 1,
      });
      importedId = imported.id;
      jobId = new JobRepository(migrated.database).create({
        importId: imported.id,
        kind: "analyze_import",
        nowMs: 1,
      }).id;
      migrated.database
        .prepare(
          `INSERT INTO "user"
           (id, name, email, emailVerified, image, createdAt, updatedAt)
           VALUES ('admin', 'Administrator', 'admin@example.test', 1, NULL, 1, 1)`,
        )
        .run();
      new InstallationRepository(migrated.database).registerSoleAdministrator(
        "admin",
        2,
      );
      migrated.close();

      process.env.MIRAWIND_ALLOWED_HOSTS = "localhost";
      process.env.MIRAWIND_AUTH_SECRET = "test-only-secret-0123456789-abcdef";
      process.env.MIRAWIND_DATA_DIR = dataRoot.path;
      process.env.MIRAWIND_PASSKEY_RP_ID = "localhost";
      process.env.MIRAWIND_PUBLIC_ORIGIN = "http://localhost";

      const cases: readonly [
        RouteHandler,
        string,
        Readonly<Record<string, string>>,
        Readonly<Record<string, string>>,
      ][] = [
        [
          getImport as RouteHandler,
          `/api/manage/imports/${importedId}`,
          { importId: importedId },
          { importId: "imp_missing0123456789abc" },
        ],
        [
          getJob as RouteHandler,
          `/api/manage/jobs/${jobId}`,
          { jobId },
          { jobId: "job_missing0123456789abc" },
        ],
        [
          getDraft as RouteHandler,
          `/api/manage/books/${bookId}/draft`,
          { bookId: String(bookId) },
          { bookId: "987654" },
        ],
        [
          getPreviewPage as RouteHandler,
          `/api/manage/books/${bookId}/preview/1/pages/1`,
          {
            bookId: String(bookId),
            configRevision: "1",
            pageId: "1",
          },
          { bookId: "987654", configRevision: "1", pageId: "1" },
        ],
        [
          getPreviewAsset as RouteHandler,
          `/api/manage/books/${bookId}/preview/1/assets/res_0123456789abcdefghij`,
          {
            bookId: String(bookId),
            configRevision: "1",
            resourceId: "res_0123456789abcdefghij",
          },
          {
            bookId: "987654",
            configRevision: "1",
            resourceId: "res_missing0123456789abc",
          },
        ],
      ];

      for (const [handler, path, existing, missing] of cases) {
        const existingResponse = await hiddenResponse(handler, path, existing);
        const missingResponse = await hiddenResponse(handler, path, missing);
        expect(existingResponse.status).toBe(404);
        expect(existingResponse.headers.get("cache-control")).toBe("no-store");
        expect(existingResponse.headers.get("x-robots-tag")).toContain(
          "noindex",
        );
        expect(await existingResponse.text()).toBe(
          await missingResponse.text(),
        );
      }

      const session = {
        authenticatedAtMs: Date.now(),
        expiresAtMs: Date.now() + 60_000,
        sessionId: "session-test",
        user: {
          email: "admin@example.test",
          id: "admin",
          name: "Administrator",
        },
      };
      const jobResponse = (await (getJob as RouteHandler)({
        locals: { session },
        params: { jobId },
      } as never)) as Response;
      expect(jobResponse.status).toBe(200);
      expect(jobResponse.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      const jobBody = (await jobResponse.json()) as Record<string, unknown>;
      expect(jobBody).toMatchObject({
        attempt: 1,
        job_id: jobId,
        kind: "analyze_import",
        phase: "queued",
        state: "queued",
      });
      expect(jobBody).not.toHaveProperty("lease_owner");
      expect(jobBody).not.toHaveProperty("error_detail");

      const importResponse = (await (getImport as RouteHandler)({
        locals: { session },
        params: { importId: importedId },
      } as never)) as Response;
      expect(await importResponse.json()).toMatchObject({
        current_job_id: jobId,
        import_id: importedId,
      });
    } finally {
      closeRuntimeAuthForTests();
      resetRuntimeStorageForTests();
      migrated.close();
      for (const key of environmentKeys) {
        const value = previous[key];
        if (value === undefined) Reflect.deleteProperty(process.env, key);
        else process.env[key] = value;
      }
      await dataRoot.cleanup();
    }
  });
});
