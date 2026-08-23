import { readFile } from "node:fs/promises";

import {
  parseReaderManifestProjection,
  type ReaderManifestPageProjection,
  type ReaderManifestResourceProjection,
} from "@/modules/publishing/application/publishing-api";
import type { StorageLayout } from "@/platform/filesystem/storage-layout";
import { resolveContainedPath } from "@/platform/filesystem/contained-path";

export type IndexedManifestPage = ReaderManifestPageProjection;
export type IndexedManifestResource = ReaderManifestResourceProjection;

interface ReaderManifest {
  readonly book_id: number;
  readonly pages: readonly IndexedManifestPage[];
  readonly resources: Readonly<Record<string, IndexedManifestResource>>;
  readonly version_id: string;
}

export interface VersionArtifactIndex {
  pageByAlias(alias: string): IndexedManifestPage | undefined;
  pageById(pageId: number): IndexedManifestPage | undefined;
  resourceById(resourceId: string): IndexedManifestResource | undefined;
}

interface CachedIndex {
  readonly bytes: number;
  readonly index: VersionArtifactIndex;
}

export interface VersionArtifactIndexInput {
  readonly bookId: number;
  readonly layout: StorageLayout;
  readonly manifestSha256: string;
  readonly versionId: string;
  readonly versionRelativePath: string;
}

type ReadManifestText = (path: string) => Promise<string>;

const maximumCachedBytes = 64 * 1024 * 1024;
const maximumCachedIndexes = 16;

function cacheKey(input: VersionArtifactIndexInput): string {
  return `${input.layout.root}\0${input.versionId}\0${input.manifestSha256}`;
}

function buildIndex(manifest: ReaderManifest): VersionArtifactIndex {
  const pagesById = new Map<number, IndexedManifestPage>();
  const pagesByAlias = new Map<string, IndexedManifestPage>();
  for (const page of manifest.pages) {
    pagesById.set(page.page_id, page);
    if (page.alias) {
      if (pagesByAlias.has(page.alias)) {
        throw new TypeError("DOCUMENT_MANIFEST_PAGE_ALIAS_DUPLICATE");
      }
      pagesByAlias.set(page.alias, page);
    }
  }
  const resourcesById = new Map(Object.entries(manifest.resources));
  return Object.freeze({
    pageByAlias: (alias: string) => pagesByAlias.get(alias),
    pageById: (pageId: number) => pagesById.get(pageId),
    resourceById: (resourceId: string) => resourcesById.get(resourceId),
  });
}

export class VersionArtifactIndexCache {
  private readonly cached = new Map<string, CachedIndex>();
  private cachedBytes = 0;
  private readonly inflight = new Map<string, Promise<VersionArtifactIndex>>();

  constructor(
    private readonly readManifestText: ReadManifestText = (path) =>
      readFile(path, "utf8"),
  ) {}

  clear(): void {
    this.cached.clear();
    this.inflight.clear();
    this.cachedBytes = 0;
  }

  load(input: VersionArtifactIndexInput): Promise<VersionArtifactIndex> {
    const key = cacheKey(input);
    const cached = this.cached.get(key);
    if (cached) {
      this.cached.delete(key);
      this.cached.set(key, cached);
      return Promise.resolve(cached.index);
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;

    const load = this.loadUncached(input).then(({ bytes, index }) => {
      this.store(key, { bytes, index });
      return index;
    });
    this.inflight.set(key, load);
    void load.then(
      () => this.inflight.delete(key),
      () => this.inflight.delete(key),
    );
    return load;
  }

  private async loadUncached(
    input: VersionArtifactIndexInput,
  ): Promise<CachedIndex> {
    const path = await resolveContainedPath(
      input.layout.root,
      `${input.versionRelativePath}/document-manifest.json`,
    );
    const json = await this.readManifestText(path);
    const parsed = JSON.parse(json) as unknown;
    const validated = parseReaderManifestProjection(parsed) as ReaderManifest;
    if (
      validated.book_id !== input.bookId ||
      validated.version_id !== input.versionId
    ) {
      throw new TypeError("DOCUMENT_MANIFEST_IDENTITY_MISMATCH");
    }
    return Object.freeze({
      bytes:
        Buffer.byteLength(json, "utf8") +
        validated.pages.length * 128 +
        Object.keys(validated.resources).length * 192,
      index: buildIndex(validated),
    });
  }

  private store(key: string, value: CachedIndex): void {
    if (value.bytes > maximumCachedBytes) return;
    const existing = this.cached.get(key);
    if (existing) {
      this.cachedBytes -= existing.bytes;
      this.cached.delete(key);
    }
    this.cached.set(key, value);
    this.cachedBytes += value.bytes;
    while (
      this.cached.size > maximumCachedIndexes ||
      this.cachedBytes > maximumCachedBytes
    ) {
      const oldestKey = this.cached.keys().next().value as string | undefined;
      if (!oldestKey) break;
      const oldest = this.cached.get(oldestKey);
      this.cached.delete(oldestKey);
      this.cachedBytes -= oldest?.bytes ?? 0;
    }
  }
}

export const sharedVersionArtifactIndex = new VersionArtifactIndexCache();
