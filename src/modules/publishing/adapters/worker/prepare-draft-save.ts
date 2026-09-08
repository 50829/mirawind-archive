import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJsonDocument } from "../filesystem/read-json-document";
import { writeDraftViews } from "../filesystem/draft-views";
import {
  acceptBookChanges,
  serializeBookDocument,
  validateBookDocument,
} from "../../core/content/book-document";
import { editBookDocument, parseDraftEdit } from "../../core/content/edit-book";
import { inspectRasterImage } from "../../core/publication/inspect-image";
import { prepareDraft } from "./prepare-draft";
import {
  rebindMineruAnalysis,
  type MineruBookAnalysis,
} from "./rebind-mineru-analysis";
import { contentEntries } from "../../core/content/content-tree";
import { atomicWriteFile } from "@/platform/filesystem/atomic-file";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";
import { isOpaqueId } from "@/domain/ids";
import { SafeApplicationError } from "@/domain/errors";

export async function prepareDraftSave(input: {
  readonly root: string;
  readonly bookId: number;
  readonly requestPath: string;
  readonly stagingDirectory: string;
  readonly signal?: AbortSignal;
  readonly onPhase?: (
    phase: "validate_edit" | "prepare_save",
    completed: number,
    total: number,
  ) => void;
}) {
  input.onPhase?.("validate_edit", 0, 2);
  const request = JSON.parse(await readFile(input.requestPath, "utf8")) as {
    expected_updated_at: number;
    patch: unknown;
    accepted_updated_at: number | null;
    document_sha256: string | null;
    prepared_path: string | null;
    no_change: 0 | 1;
  };
  const bookRoot = resolve(input.root, "books", String(input.bookId));
  const draftPath = resolve(bookRoot, "draft/book.json");
  const current = validateBookDocument(
    await readJsonDocument(draftPath, input.signal),
    input.bookId,
  );
  if (
    request.accepted_updated_at !== null &&
    current.updated_at === request.accepted_updated_at &&
    request.document_sha256 ===
      createHash("sha256").update(serializeBookDocument(current)).digest("hex")
  ) {
    return {
      alreadyApplied: true,
      acceptedUpdatedAt: current.updated_at,
      documentSha256: request.document_sha256,
      noChange: request.no_change === 1,
    };
  }
  if (current.updated_at !== request.expected_updated_at)
    throw new SafeApplicationError(
      "DRAFT_PRECONDITION_FAILED",
      "The draft changed since it was read.",
      412,
    );
  if (request.accepted_updated_at !== null && request.prepared_path) {
    const prepared = validateBookDocument(
      await readJsonDocument(
        await resolveContainedPath(input.root, request.prepared_path),
        input.signal,
      ),
      input.bookId,
    );
    if (
      prepared.updated_at !== request.accepted_updated_at ||
      createHash("sha256")
        .update(serializeBookDocument(prepared))
        .digest("hex") !== request.document_sha256
    )
      throw new Error("DRAFT_SAVE_INTEGRITY_MISMATCH");
    if (!request.document_sha256)
      throw new Error("DRAFT_SAVE_INTEGRITY_MISMATCH");
    return {
      alreadyApplied: false,
      acceptedUpdatedAt: prepared.updated_at,
      documentSha256: request.document_sha256,
      noChange: request.no_change === 1,
    };
  }
  const patch = request.patch as Record<string, unknown>;
  let next: typeof current;
  const assets: {
    id: string;
    path: string;
    sha256: string;
    size: number;
    media_type: string;
  }[] = [];
  const prepared = resolve(input.stagingDirectory, "prepared-save");
  const now = request.accepted_updated_at ?? Date.now();
  if (patch.kind === "cover") {
    const resourceId = String(patch.resource_id);
    const upload = String(patch.upload_path);
    if (
      !isOpaqueId("resource", resourceId) ||
      upload !== `tmp/covers/${resourceId}/upload`
    )
      throw new Error("COVER_UPLOAD_INVALID");
    const bytes = await readFile(
      await resolveContainedPath(input.root, upload),
    );
    if (bytes.byteLength > 20 * 1024 * 1024)
      throw new Error("COVER_SIZE_LIMIT");
    const image = await inspectRasterImage({
      bytes,
      filename: String(patch.filename),
    });
    const path = `assets/${resourceId}.${image.format === "jpeg" ? "jpg" : image.format}`;
    const resource = {
      id: resourceId,
      path,
      media_type: `image/${image.format}`,
    };
    next = structuredClone(current);
    next.resources.push(resource);
    next.metadata.cover_resource_id = resourceId;
    next = acceptBookChanges(current, next, request.expected_updated_at, now);
    await atomicWriteFile(resolve(prepared, path), bytes, { mode: 0o400 });
    assets.push({
      ...resource,
      size: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  } else if (patch.kind === "reprocess") {
    const original = JSON.parse(
      await readFile(resolve(bookRoot, "draft/import.json"), "utf8"),
    ) as { files: { id: string; path: string }[] };
    const file = original.files[0];
    if (
      !file ||
      !isOpaqueId("file", file.id) ||
      file.path !== `originals/${file.id}`
    )
      throw new Error("REPROCESS_ORIGINAL_INVALID");
    const source = JSON.parse(
      await readFile(resolve(bookRoot, "draft/import-source.json"), "utf8"),
    ) as { selected_path: string };
    const profile = patch.typography_profile;
    if (profile !== "verbatim-v1" && profile !== "zh-smart-v2")
      throw new Error("REPROCESS_PROFILE_INVALID");
    const result = await prepareDraft({
      archivePath: resolve(bookRoot, file.path),
      bookId: input.bookId,
      selectedCandidatePath: source.selected_path,
      stagingDirectory: resolve(input.stagingDirectory, "reprocess"),
      typographyProfile: profile,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    next = validateBookDocument(
      await readJsonDocument(
        resolve(result.preparedRoot, "draft/book.json"),
        input.signal,
      ),
      input.bookId,
    );
    const oldAnalysis = JSON.parse(
      await readFile(
        resolve(
          bookRoot,
          "draft/views",
          String(current.updated_at),
          "analysis.json",
        ),
        "utf8",
      ),
    ) as MineruBookAnalysis;
    const newAnalysis = JSON.parse(
      await readFile(
        resolve(
          result.preparedRoot,
          "draft/views",
          String(next.updated_at),
          "analysis.json",
        ),
        "utf8",
      ),
    ) as MineruBookAnalysis;
    const ids = new Map<string, string>();
    for (const [index, origin] of newAnalysis.origins.entries()) {
      const old = oldAnalysis.origins[index];
      if (
        old &&
        old.page_index === origin.page_index &&
        old.source_type === origin.source_type
      )
        ids.set(origin.block_id, old.block_id);
    }
    const oldNodes = new Map(
      [...contentEntries(current.blocks)].map((entry) => [
        entry.node.id,
        entry.node,
      ]),
    );
    for (const entry of contentEntries(next.blocks)) {
      entry.node.id = ids.get(entry.node.id) ?? entry.node.id;
      const old = oldNodes.get(entry.node.id);
      if (
        "type" in entry.node &&
        entry.node.type === "heading" &&
        old &&
        "type" in old &&
        old.type === "heading"
      )
        entry.node.exclude_from_numbering = old.exclude_from_numbering;
    }
    for (const [key, id] of Object.entries(next.publishing.boundaries))
      Reflect.set(next.publishing.boundaries, key, ids.get(id) ?? id);
    next.metadata = structuredClone(current.metadata);
    next.publishing.numbering = current.publishing.numbering;
    next.publishing.code = current.publishing.code;
    if (current.alias) next.alias = current.alias;
    if (current.metadata.cover_resource_id) {
      const cover = current.resources.find(
        (resource) => resource.id === current.metadata.cover_resource_id,
      );
      if (cover) next.resources.push(cover);
    }
    next = acceptBookChanges(current, next, request.expected_updated_at, now);
    for (const asset of result.artifact.resources) {
      await atomicWriteFile(
        resolve(prepared, asset.path),
        await readFile(resolve(result.preparedRoot, asset.path)),
        { mode: 0o400 },
      );
      assets.push({ ...asset });
    }
    await atomicWriteFile(
      resolve(prepared, "views", String(next.updated_at), "analysis.json"),
      JSON.stringify(rebindMineruAnalysis(newAnalysis, ids)) + "\n",
      { mode: 0o600 },
    );
  } else {
    next = editBookDocument(
      current,
      parseDraftEdit(request.patch),
      request.expected_updated_at,
      now,
    );
  }
  input.signal?.throwIfAborted();
  input.onPhase?.("prepare_save", 1, 2);
  const json = serializeBookDocument(next);
  await atomicWriteFile(resolve(prepared, "book.json"), json, { mode: 0o600 });
  await writeDraftViews(next, prepared);
  if (patch.kind !== "reprocess")
    await atomicWriteFile(
      resolve(prepared, "views", String(next.updated_at), "analysis.json"),
      await readFile(
        resolve(
          bookRoot,
          "draft/views",
          String(current.updated_at),
          "analysis.json",
        ),
      ),
      { mode: 0o600 },
    );
  await atomicWriteFile(
    resolve(prepared, "assets.json"),
    JSON.stringify(assets) + "\n",
    { mode: 0o600 },
  );
  input.onPhase?.("prepare_save", 2, 2);
  return {
    alreadyApplied: false,
    acceptedUpdatedAt: next.updated_at,
    documentSha256: createHash("sha256").update(json).digest("hex"),
    noChange: next.updated_at === current.updated_at,
  };
}
