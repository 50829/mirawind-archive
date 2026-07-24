import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ImportRepository } from "@/db/repositories/imports";
import {
  analyzeImport,
  persistAnalyzeImportArtifact,
  readAnalyzeImportArtifact,
} from "@/jobs/handlers/analyze-import";
import { buildZip } from "../../../scripts/fixtures/zip-builder";
import { withMigratedTestDatabase } from "../../helpers/database.js";

const sha256 = "a".repeat(64);

async function runAnalysis(
  dataRoot: { readonly path: string },
  entries: readonly { readonly data: string; readonly name: string }[],
) {
  await mkdir(dataRoot.path, { recursive: true });
  const archivePath = resolve(dataRoot.path, "input.zip");
  await writeFile(archivePath, buildZip({ entries }));
  return analyzeImport({
    archivePath,
    stagingDirectory: resolve(dataRoot.path, "staging/job_abcdefghijklmnop"),
  });
}

describe("analyze_import handler", () => {
  it("extracts a high-confidence bundle and durably selects it for preparation", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const result = await runAnalysis(dataRoot, [
        {
          data: "# Book\n\n![image](images/a.png)",
          name: "wrapper/full.md",
        },
        { data: "{}", name: "wrapper/layout.json" },
        { data: "image", name: "wrapper/images/a.png" },
      ]);
      const artifact = await readAnalyzeImportArtifact(result.artifactPath);
      const artifactText = await readFile(result.artifactPath, "utf8");

      expect(artifact).toMatchObject({
        decision: "automatic",
        reason: "cloud-high-confidence",
        selectedCandidateId: expect.stringMatching(/^cand_/u),
      });
      expect(artifact.candidates[0]?.normalizedPath).toBe("wrapper/full.md");
      expect(artifactText).not.toContain(dataRoot.path);

      const imports = new ImportRepository(database);
      const imported = imports.createUploaded({
        expiresAtMs: 10_000,
        id: "imp_abcdefghijklmnop",
        nowMs: 1,
        uploadRelativePath: "tmp/uploads/imp_abcdefghijklmnop/original.zip",
        uploadSha256: sha256,
        uploadSizeBytes: 10,
      });
      imports.startAnalysis(imported.id, 2);
      expect(
        persistAnalyzeImportArtifact({
          artifact,
          importId: imported.id,
          nowMs: 3,
          repository: imports,
        }),
      ).toMatchObject({
        selectedCandidateId: artifact.selectedCandidateId,
        state: "preparing",
      });
      expect(imports.candidates(imported.id)).toHaveLength(1);
    }));

  it("pauses generic input for confirmation and rejects missing Markdown with a safe code", () =>
    withMigratedTestDatabase(async ({ database }, dataRoot) => {
      const imports = new ImportRepository(database);
      const generic = await runAnalysis(dataRoot, [
        { data: "# Notes", name: "notes.md" },
      ]);
      const first = imports.createUploaded({
        expiresAtMs: 10_000,
        id: "imp_abcdefghijklmnop",
        nowMs: 1,
        uploadRelativePath: "tmp/uploads/imp_abcdefghijklmnop/original.zip",
        uploadSha256: sha256,
        uploadSizeBytes: 10,
      });
      imports.startAnalysis(first.id, 2);
      expect(
        persistAnalyzeImportArtifact({
          artifact: generic.artifact,
          importId: first.id,
          nowMs: 3,
          repository: imports,
        }),
      ).toMatchObject({
        selectedCandidateId: null,
        state: "needs_main_confirmation",
      });

      const secondRoot = {
        path: resolve(dataRoot.path, "second"),
      };
      const rejected = await runAnalysis(secondRoot, [
        { data: "not markdown", name: "readme.txt" },
      ]);
      const second = imports.createUploaded({
        expiresAtMs: 10_000,
        id: "imp_qrstuvwxyzabcdef",
        nowMs: 4,
        uploadRelativePath: "tmp/uploads/imp_qrstuvwxyzabcdef/original.zip",
        uploadSha256: sha256,
        uploadSizeBytes: 10,
      });
      imports.startAnalysis(second.id, 5);
      expect(
        persistAnalyzeImportArtifact({
          artifact: rejected.artifact,
          importId: second.id,
          nowMs: 6,
          repository: imports,
        }),
      ).toMatchObject({
        safeErrorCode: "IMPORT_MAIN_MARKDOWN_MISSING",
        state: "rejected",
      });
    }));
});
