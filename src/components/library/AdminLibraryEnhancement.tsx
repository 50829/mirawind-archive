import { useEffect, useState } from "react";

import type { AdministratorLibraryEntry } from "../../services/library.js";

interface ResponseBody {
  readonly entries: readonly {
    readonly book_id: number;
    readonly current_version_available: boolean;
    readonly preview_ready: boolean;
    readonly primary_href: string;
    readonly status_label: string;
    readonly title: string;
    readonly visibility: AdministratorLibraryEntry["visibility"];
  }[];
  readonly next_cursor: string | null;
}

export function AdminLibraryEnhancement() {
  const [entries, setEntries] = useState<
    readonly AdministratorLibraryEntry[] | null
  >(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const collected: ResponseBody["entries"][number][] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 50; page += 1) {
        const url = new URL("/api/manage/library", window.location.origin);
        if (cursor) url.searchParams.set("cursor", cursor);
        const response = await fetch(url, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body = (await response.json()) as ResponseBody;
        collected.push(...body.entries);
        cursor = body.next_cursor;
        if (!cursor) break;
      }
      setEntries(
        collected.map((entry) => ({
          bookId: entry.book_id,
          currentVersionAvailable: entry.current_version_available,
          previewReady: entry.preview_ready,
          primaryHref: entry.primary_href,
          statusLabel: entry.status_label,
          title: entry.title,
          visibility: entry.visibility,
        })),
      );
    };
    void load().catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!entries) return null;
  return (
    <aside aria-labelledby="admin-library-heading" className="admin-library">
      <header>
        <div>
          <p className="eyebrow">ADMIN</p>
          <h2 id="admin-library-heading">管理中的图书</h2>
        </div>
        <a href="/manage">导入新书</a>
      </header>
      {entries.length === 0 ? (
        <p>没有需要管理的图书。</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.bookId}>
              <a href={entry.primaryHref}>{entry.title}</a>
              <span>{entry.statusLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
