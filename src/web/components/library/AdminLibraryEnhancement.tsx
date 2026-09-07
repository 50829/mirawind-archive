import { BookOpen, Settings, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { AdministratorLibraryEntry } from "@/modules/catalog/application/catalog-api";

interface ResponseBody {
  readonly entries: readonly {
    readonly access: AdministratorLibraryEntry["access"];
    readonly book_id: number;
    readonly current_version_available: boolean;
    readonly deletion_mutation_token: string;
    readonly management_href: string;
    readonly reading_href: string | null;
    readonly status_label: string;
    readonly title: string;
  }[];
  readonly next_cursor: string | null;
}

interface ManagementCapability {
  readonly management_available: boolean;
}

export function AdminLibraryEnhancement() {
  const [entries, setEntries] = useState<
    readonly AdministratorLibraryEntry[] | null
  >(null);
  const [deleting, setDeleting] = useState<AdministratorLibraryEntry | null>(
    null,
  );
  const [confirmationTitle, setConfirmationTitle] = useState("");
  const [deletionError, setDeletionError] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionRequestKey, setDeletionRequestKey] = useState("");
  const [acceptedTask, setAcceptedTask] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const capabilityResponse = await fetch(
        "/api/library/management-capability",
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        },
      );
      if (!capabilityResponse.ok) return;
      const capability =
        (await capabilityResponse.json()) as ManagementCapability;
      if (capability.management_available !== true) return;

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
          access: entry.access,
          bookId: entry.book_id,
          currentVersionAvailable: entry.current_version_available,
          deletionMutationToken: entry.deletion_mutation_token,
          managementHref: entry.management_href,
          readingHref: entry.reading_href,
          statusLabel: entry.status_label,
          title: entry.title,
        })),
      );
    };
    void load().catch(() => undefined);
    return () => controller.abort();
  }, []);
  function closeDeletion() {
    if (deletionBusy) return;
    setDeleting(null);
    setConfirmationTitle("");
    setDeletionError("");
    setDeletionRequestKey("");
  }

  async function confirmDeletion() {
    if (
      !deleting ||
      !deletionRequestKey ||
      confirmationTitle.normalize("NFC") !== deleting.title.normalize("NFC")
    ) {
      return;
    }
    setDeletionBusy(true);
    setDeletionError("");
    try {
      const response = await fetch(`/api/manage/books/${deleting.bookId}`, {
        body: JSON.stringify({ confirmationTitle }),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": deletionRequestKey,
          "If-Match": deleting.deletionMutationToken,
        },
        method: "DELETE",
      });
      const body = (await response.json()) as {
        readonly code?: string;
        readonly taskUrl?: string;
      };
      if (!response.ok) {
        setDeletionError(
          body.code === "DELETION_CONFIRMATION_STALE"
            ? "图书已发生变化，请关闭窗口并刷新后重试。"
            : body.code === "INVALID_ORIGIN"
              ? "页面地址已变化，请刷新后重试。"
              : "删除失败，请稍后重试。",
        );
        return;
      }
      setEntries(
        (current) =>
          current?.filter((entry) => entry.bookId !== deleting.bookId) ?? null,
      );
      setAcceptedTask(body.taskUrl ?? "/manage/tasks");
      setDeleting(null);
      setConfirmationTitle("");
    } catch {
      setDeletionError("无法提交永久删除，请检查连接后重试。");
    } finally {
      setDeletionBusy(false);
    }
  }
  if (!entries) return null;
  return (
    <aside aria-labelledby="admin-library-heading" className="admin-library">
      <header>
        <div>
          <h2 id="admin-library-heading">管理中的图书</h2>
        </div>
        <a href="/manage">导入新书</a>
      </header>
      {acceptedTask && (
        <p role="status">
          已删除。<a href={acceptedTask}>查看任务</a>
        </p>
      )}
      {entries.length === 0 ? (
        <p>没有需要管理的图书。</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li
              className="grid min-h-14 grid-cols-[minmax(0,1fr)_6rem_auto] items-center gap-4 max-sm:grid-cols-[minmax(0,1fr)_auto]"
              key={entry.bookId}
            >
              <a
                className="min-w-0 [overflow-wrap:anywhere] font-semibold text-stone-900"
                href={entry.managementHref}
              >
                {entry.title}
              </a>
              <span className="justify-self-end text-sm">
                {entry.statusLabel}
              </span>
              <div className="flex items-center justify-end gap-2 max-sm:col-span-2">
                <a
                  className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-100 px-3 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-200"
                  href={entry.managementHref}
                >
                  <Settings aria-hidden="true" size={17} />
                  管理
                </a>
                {entry.readingHref && (
                  <a
                    className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-800 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
                    href={entry.readingHref}
                  >
                    <BookOpen aria-hidden="true" size={17} />
                    阅读
                  </a>
                )}
                <button
                  aria-label={`永久删除《${entry.title}》`}
                  className="inline-flex size-11 items-center justify-center rounded-md bg-red-800 text-white hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
                  onClick={() => {
                    setAcceptedTask(null);
                    setDeleting(entry);
                    setDeletionRequestKey(crypto.randomUUID());
                    setConfirmationTitle("");
                    setDeletionError("");
                  }}
                  title="永久删除"
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <BookDeletionDialog
          book={deleting}
          busy={deletionBusy}
          confirmationTitle={confirmationTitle}
          error={deletionError}
          onCancel={closeDeletion}
          onChange={setConfirmationTitle}
          onConfirm={() => void confirmDeletion()}
        />
      )}
    </aside>
  );
}

export function BookDeletionDialog(props: {
  readonly book: AdministratorLibraryEntry;
  readonly busy: boolean;
  readonly confirmationTitle: string;
  readonly error: string;
  readonly onCancel: () => void;
  readonly onChange: (title: string) => void;
  readonly onConfirm: () => void;
}) {
  const confirmationInput = useRef<HTMLInputElement>(null);
  useEffect(() => confirmationInput.current?.focus(), []);
  const matches =
    props.confirmationTitle.normalize("NFC") ===
    props.book.title.normalize("NFC");
  return (
    <dialog
      aria-labelledby="delete-book-title"
      className="fixed inset-0 z-50 m-auto w-[min(32rem,calc(100%-2rem))] rounded-lg border border-stone-300 bg-white p-6 text-stone-900 shadow-xl backdrop:bg-stone-950/60"
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
      open
    >
      <h3 className="text-xl font-bold" id="delete-book-title">
        永久删除《{props.book.title}》
      </h3>
      <label
        className="mt-5 block font-medium"
        htmlFor="delete-book-confirmation"
      >
        输入完整书名以确认
      </label>
      <input
        className="mt-2 w-full rounded-md border border-stone-400 bg-white px-3 py-2 text-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
        id="delete-book-confirmation"
        onChange={(event) => props.onChange(event.currentTarget.value)}
        ref={confirmationInput}
        type="text"
        value={props.confirmationTitle}
      />
      {props.error && (
        <p className="mt-3 text-red-800" role="alert">
          {props.error}
        </p>
      )}
      <div className="mt-6 flex justify-end gap-3">
        <button
          className="rounded-md border border-stone-400 bg-white px-4 py-2 font-semibold text-stone-900 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2"
          disabled={props.busy}
          onClick={props.onCancel}
          type="button"
        >
          取消
        </button>
        <button
          className="rounded-md bg-red-800 px-4 py-2 font-semibold text-white hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={props.busy || !matches}
          onClick={props.onConfirm}
          type="button"
        >
          {props.busy ? "正在删除…" : "永久删除"}
        </button>
      </div>
    </dialog>
  );
}
