import { type ComponentProps, useState } from "react";

import { authClient } from "../../identity/auth-client";

export interface ManagedPasskey {
  readonly backedUp: boolean;
  readonly createdAt: string | null;
  readonly deviceType: string;
  readonly id: string;
  readonly lastUsedAt: string | null;
  readonly name: string | null;
}

export interface PasskeyManagerProps {
  readonly initialPasskeys: readonly ManagedPasskey[];
}

type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<"form">["onSubmit"]>
>[0];

function dateLabel(value: string | null): string {
  if (!value) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PasskeyManager({ initialPasskeys }: PasskeyManagerProps) {
  const [passkeys, setPasskeys] = useState([...initialPasskeys]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const result = await authClient.passkey.listUserPasskeys();
    if (result.error) throw new Error("PASSKEY_LIST_FAILED");
    setPasskeys((current) =>
      result.data.map((passkey) => ({
        backedUp: passkey.backedUp,
        createdAt: passkey.createdAt
          ? new Date(passkey.createdAt).toISOString()
          : null,
        deviceType: passkey.deviceType,
        id: passkey.id,
        lastUsedAt:
          current.find((item) => item.id === passkey.id)?.lastUsedAt ?? null,
        name: passkey.name ?? null,
      })),
    );
  }

  async function addPasskey(event: FormSubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage("");
    const result = await authClient.passkey.addPasskey({
      name: String(data.get("name") ?? "").trim(),
    });
    if (result.error) {
      setMessage("登记失败。请确认刚刚完成登录，且尚未达到 10 把上限。");
    } else {
      form.reset();
      await refresh();
      setMessage("Passkey 已登记。");
    }
    setBusy(false);
  }

  async function renamePasskey(event: FormSubmitEvent, passkeyId: string) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    const result = await authClient.passkey.updatePasskey({
      id: passkeyId,
      name: String(data.get("name") ?? "").trim(),
    });
    if (result.error) {
      setMessage("重命名失败。敏感操作要求最近 5 分钟内完成登录。");
    } else {
      await refresh();
      setMessage("名称已更新。");
    }
    setBusy(false);
  }

  async function deleteNonFinal(passkeyId: string) {
    if (!window.confirm("确定删除这把 Passkey？")) return;
    setBusy(true);
    setMessage("");
    const result = await authClient.passkey.deletePasskey({ id: passkeyId });
    if (result.error) {
      setMessage("删除失败。最后一把 Passkey 必须验证备用密码。");
    } else {
      await refresh();
      setMessage("Passkey 已删除。");
    }
    setBusy(false);
  }

  async function deleteFinal(event: FormSubmitEvent, passkeyId: string) {
    event.preventDefault();
    if (
      !window.confirm(
        "这是最后一把 Passkey。删除后只能使用备用密码登录，确定继续？",
      )
    ) {
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage("");
    const response = await fetch(
      `/api/manage/security/passkeys/${encodeURIComponent(passkeyId)}/delete-final`,
      {
        body: JSON.stringify({
          current_password: String(data.get("current_password") ?? ""),
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    if (!response.ok) {
      setMessage(
        response.status === 409
          ? "Passkey 列表已经变化，请刷新后重试。"
          : "删除失败，请检查备用密码和登录新鲜度。",
      );
    } else {
      form.reset();
      await refresh();
      setMessage("最后一把 Passkey 已删除；备用密码仍可登录。");
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby="passkey-heading">
      <div className="heading-row">
        <div>
          <p className="eyebrow">安全设置</p>
          <h1 id="passkey-heading">Passkey</h1>
        </div>
        <span className="count">{passkeys.length} / 10</span>
      </div>
      <p>
        建议登记至少两把、分属不同故障域的 Passkey。新增、重命名和删除要求最近 5
        分钟内完成登录。
      </p>
      <a href="/login?next=/manage/security">重新登录以刷新验证</a>

      <form className="add-form" onSubmit={addPasskey}>
        <label>
          新 Passkey 名称
          <input
            disabled={passkeys.length >= 10}
            maxLength={120}
            name="name"
            placeholder="例如：手机同步 Passkey"
            required
          />
        </label>
        <button disabled={busy || passkeys.length >= 10} type="submit">
          登记新 Passkey
        </button>
      </form>

      <ul className="passkey-list">
        {passkeys.map((passkey) => (
          <li key={passkey.id}>
            <div>
              <strong>{passkey.name || "未命名 Passkey"}</strong>
              <p>
                创建于 {dateLabel(passkey.createdAt)} · 最近使用{" "}
                {dateLabel(passkey.lastUsedAt)} ·{" "}
                {passkey.backedUp ? "已备份" : "未标记备份"} ·{" "}
                {passkey.deviceType}
              </p>
            </div>
            <form onSubmit={(event) => renamePasskey(event, passkey.id)}>
              <label>
                <span className="sr-only">新名称</span>
                <input
                  defaultValue={passkey.name ?? ""}
                  maxLength={120}
                  name="name"
                  required
                />
              </label>
              <button disabled={busy} type="submit">
                重命名
              </button>
            </form>
            {passkeys.length === 1 ? (
              <form
                className="danger"
                onSubmit={(event) => deleteFinal(event, passkey.id)}
              >
                <label>
                  删除最后一把前输入备用密码
                  <input
                    autoComplete="current-password"
                    minLength={16}
                    name="current_password"
                    required
                    type="password"
                  />
                </label>
                <button disabled={busy} type="submit">
                  验证密码并删除最后一把
                </button>
              </form>
            ) : (
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => deleteNonFinal(passkey.id)}
                type="button"
              >
                删除
              </button>
            )}
          </li>
        ))}
      </ul>
      {passkeys.length === 0 && (
        <p className="empty">尚未登记 Passkey；当前可使用备用密码登录。</p>
      )}
      {message && (
        <p aria-live="polite" className="message">
          {message}
        </p>
      )}
    </section>
  );
}
