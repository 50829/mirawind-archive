import { useEffect, useRef, useState } from "react";

import type { AdministratorLibraryEntry } from "@/modules/catalog/application/public";

interface ResponseBody {
  readonly entries: readonly {
    readonly book_id: number;
    readonly current_version_available: boolean;
    readonly deletion_mutation_token: string;
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
          deletionMutationToken: entry.deletion_mutation_token,
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
            : `永久删除未被接受：${body.code ?? response.status}`,
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
          <p className="eyebrow">ADMIN</p>
          <h2 id="admin-library-heading">管理中的图书</h2>
        </div>
        <a href="/manage">导入新书</a>
      </header>
      {acceptedTask && (
        <p role="status">
          永久删除已接受，图书已隐藏。<a href={acceptedTask}>查看清理任务</a>
        </p>
      )}
      {entries.length === 0 ? (
        <p>没有需要管理的图书。</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.bookId}>
              <a href={entry.primaryHref}>{entry.title}</a>
              <span>{entry.statusLabel}</span>
              <button
                className="rounded-md bg-red-800 px-3 py-2 text-sm font-semibold text-white hover:bg-red-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
                onClick={() => {
                  setAcceptedTask(null);
                  setDeleting(entry);
                  setDeletionRequestKey(crypto.randomUUID());
                  setConfirmationTitle("");
                  setDeletionError("");
                }}
                type="button"
              >
                永久删除
              </button>
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
      className="fixed inset-0 z-50 m-auto max-w-lg rounded-xl border border-stone-300 bg-white p-6 text-stone-900 shadow-xl backdrop:bg-stone-950/60"
      onCancel={(event) => {
        event.preventDefault();
        props.onCancel();
      }}
      open
    >
      <h3 className="text-xl font-bold" id="delete-book-title">
        永久删除《{props.book.title}》
      </h3>
      <p className="mt-3">
        此操作立即生效、不可撤销，没有回收站，也无法恢复。相关后台任务会被取消，文件由清理任务删除。
      </p>
      <label
        className="mt-5 block font-medium"
        htmlFor="delete-book-confirmation"
      >
        输入完整书名以确认
      </label>
      <input
        aria-describedby="delete-book-warning"
        className="mt-2 w-full rounded-md border border-stone-400 bg-white px-3 py-2 text-stone-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
        id="delete-book-confirmation"
        onChange={(event) => props.onChange(event.currentTarget.value)}
        ref={confirmationInput}
        type="text"
        value={props.confirmationTitle}
      />
      <p className="mt-2 text-sm text-red-800" id="delete-book-warning">
        必须与当前显示的书名完全一致。
      </p>
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
          {props.busy ? "正在提交…" : "永久删除，无法恢复"}
        </button>
      </div>
    </dialog>
  );
}
