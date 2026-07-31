import { Check, ImageUp, Settings, X } from "lucide-react";
import { useRef, useState } from "react";

import {
  manageDialog,
  manageDialogClose,
  manageDialogHeader,
  managePrimaryButton,
  manageQuietButton,
  manageSecondaryButton,
} from "@/web/components/ui/manage-classes";
import type { DraftView } from "@/web/contracts/publishing";

interface DraftImageChoice {
  readonly height: number;
  readonly media_type: string;
  readonly path: string;
  readonly selected: boolean;
  readonly size_bytes: number;
  readonly url: string;
  readonly width: number;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function authorsValue(value: unknown): string {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .join("\n")
    : "";
}

export function BookSettingsDialog(props: {
  readonly disabled: boolean;
  readonly draft: DraftView;
  readonly etag: string;
  readonly onChanged: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [alias, setAlias] = useState(props.draft.alias ?? "");
  const [authors, setAuthors] = useState(
    authorsValue(props.draft.metadata.authors),
  );
  const [coverPath, setCoverPath] = useState(
    stringValue(props.draft.metadata.cover_path) || null,
  );
  const [description, setDescription] = useState(
    stringValue(props.draft.metadata.description),
  );
  const [error, setError] = useState("");
  const [images, setImages] = useState<readonly DraftImageChoice[]>([]);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(stringValue(props.draft.metadata.title));

  function resetFields() {
    setAlias(props.draft.alias ?? "");
    setAuthors(authorsValue(props.draft.metadata.authors));
    setCoverPath(stringValue(props.draft.metadata.cover_path) || null);
    setDescription(stringValue(props.draft.metadata.description));
    setTitle(stringValue(props.draft.metadata.title));
    setError("");
  }

  async function open() {
    resetFields();
    dialog.current?.showModal();
    try {
      const response = await fetch(
        `/api/manage/books/${props.draft.book_id}/draft/images`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (!response.ok) {
        setImages([]);
        return;
      }
      const result = (await response.json()) as {
        readonly images?: readonly DraftImageChoice[];
      };
      setImages(result.images ?? []);
    } catch {
      setImages([]);
    }
  }

  async function saveMetadata() {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("标题不能为空。");
      return;
    }
    const normalizedAuthors = [
      ...new Set(
        authors
          .split(/[，,\n]/u)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    ];
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/manage/books/${props.draft.book_id}/draft`,
        {
          body: JSON.stringify({
            alias: alias.trim() || null,
            changes: [],
            metadata: {
              authors: normalizedAuthors.length > 0 ? normalizedAuthors : null,
              cover_path: coverPath,
              description: description.trim() || null,
              title: normalizedTitle,
            },
          }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "If-Match": props.etag,
          },
          method: "PATCH",
        },
      );
      if (!response.ok) {
        setError(
          response.status === 412
            ? "草稿已更新，请关闭后重新打开设置。"
            : "书籍设置未保存，请检查填写内容。",
        );
        return;
      }
      dialog.current?.close();
      await props.onChanged();
    } catch {
      setError("书籍设置保存失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function uploadCover(file: File) {
    setSaving(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await fetch(
        `/api/manage/books/${props.draft.book_id}/draft/cover`,
        {
          body,
          cache: "no-store",
          credentials: "same-origin",
          headers: { "If-Match": props.etag },
          method: "POST",
        },
      );
      if (!response.ok) {
        setError(
          response.status === 412
            ? "草稿已更新，请关闭后重新打开设置。"
            : "封面上传失败，请使用 PNG、JPEG、WebP 或静态 GIF。",
        );
        return;
      }
      dialog.current?.close();
      await props.onChanged();
    } catch {
      setError("封面上传失败，请稍后重试。");
    } finally {
      setSaving(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function changeAccess(access: DraftView["access"]) {
    if (access === props.draft.access) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/manage/books/${props.draft.book_id}/access`,
        {
          body: JSON.stringify({ access }),
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        },
      );
      if (!response.ok) {
        setError(
          response.status === 409
            ? "发布当前版本后才能设为公开。"
            : "访问权限未更新。",
        );
        return;
      }
      await props.onChanged();
    } catch {
      setError("访问权限更新失败，请稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        className={manageSecondaryButton}
        disabled={props.disabled}
        onClick={() => void open()}
        ref={trigger}
        type="button"
      >
        <Settings aria-hidden="true" size={18} />
        书籍设置
      </button>
      <dialog
        aria-labelledby="book-settings-title"
        className={`${manageDialog} w-[min(52rem,calc(100vw-2rem))]`}
        onClose={() => trigger.current?.focus()}
        ref={dialog}
      >
        <header className={manageDialogHeader}>
          <span id="book-settings-title">书籍设置</span>
          <button
            aria-label="关闭书籍设置"
            className={manageDialogClose}
            disabled={saving}
            onClick={() => dialog.current?.close()}
            title="关闭"
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
        </header>
        <div className="grid max-h-[calc(100dvh-5rem)] gap-5 overflow-auto p-5">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <label className="grid gap-1.5 text-sm font-semibold">
              显示名称
              <input
                autoFocus
                className="rounded-md border border-stone-300 bg-white px-3 py-2 font-normal"
                maxLength={500}
                onChange={(event) => setTitle(event.currentTarget.value)}
                value={title}
              />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              路由别名
              <input
                className="rounded-md border border-stone-300 bg-white px-3 py-2 font-normal"
                maxLength={120}
                onChange={(event) => setAlias(event.currentTarget.value)}
                value={alias}
              />
            </label>
          </div>
          <label className="grid gap-1.5 text-sm font-semibold">
            作者或整理者
            <textarea
              className="min-h-20 resize-y rounded-md border border-stone-300 bg-white px-3 py-2 font-normal"
              onChange={(event) => setAuthors(event.currentTarget.value)}
              value={authors}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            简介
            <textarea
              className="min-h-28 resize-y rounded-md border border-stone-300 bg-white px-3 py-2 font-normal"
              maxLength={10_000}
              onChange={(event) => setDescription(event.currentTarget.value)}
              value={description}
            />
          </label>
          <fieldset className="grid gap-3">
            <legend className="text-sm font-semibold">封面</legend>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-3">
              <button
                aria-pressed={coverPath === null}
                className="relative aspect-[3/4] rounded-md border border-stone-300 bg-stone-100 p-2 text-sm font-semibold"
                onClick={() => setCoverPath(null)}
                type="button"
              >
                自动封面
                {coverPath === null && (
                  <Check className="absolute right-2 top-2" size={18} />
                )}
              </button>
              {images.map((image, index) => (
                <button
                  aria-label={`选择封面 ${index + 1}`}
                  aria-pressed={coverPath === image.path}
                  className="relative aspect-[3/4] overflow-hidden rounded-md border border-stone-300 bg-stone-100"
                  key={image.path}
                  onClick={() => setCoverPath(image.path)}
                  type="button"
                >
                  <img
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    src={image.url}
                  />
                  {coverPath === image.path && (
                    <Check
                      className="absolute right-2 top-2 rounded-full bg-white p-0.5 text-emerald-800"
                      size={20}
                    />
                  )}
                </button>
              ))}
            </div>
            <input
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void uploadCover(file);
              }}
              ref={fileInput}
              type="file"
            />
            <button
              className={`${manageQuietButton} w-fit`}
              disabled={saving}
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              <ImageUp aria-hidden="true" size={18} />
              上传封面
            </button>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold">访问权限</legend>
            <div className="flex w-fit gap-1 rounded-md bg-stone-100 p-1">
              {(["private", "public"] as const).map((access) => (
                <button
                  aria-pressed={props.draft.access === access}
                  className={manageQuietButton}
                  disabled={
                    saving || (access === "public" && !props.draft.published)
                  }
                  key={access}
                  onClick={() => void changeAccess(access)}
                  type="button"
                >
                  {access === "private" ? "私有" : "公开"}
                </button>
              ))}
            </div>
          </fieldset>
          {error && (
            <p className="text-sm text-red-800" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              className={manageQuietButton}
              disabled={saving}
              onClick={() => dialog.current?.close()}
              type="button"
            >
              取消
            </button>
            <button
              className={managePrimaryButton}
              disabled={saving || props.disabled}
              onClick={() => void saveMetadata()}
              type="button"
            >
              {saving ? "正在保存" : "保存设置并更新预览"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
