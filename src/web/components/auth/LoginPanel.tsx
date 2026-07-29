import { type ComponentProps, useState } from "react";

import { authClient } from "@/web/identity/auth-client";

export interface LoginPanelProps {
  readonly nextPath?: string;
}

type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<"form">["onSubmit"]>
>[0];

function safeNextPath(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/manage";
}

export function LoginPanel({ nextPath }: LoginPanelProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const destination = safeNextPath(nextPath);

  async function signInWithPasskey() {
    setBusy(true);
    setMessage("");
    const result = await authClient.signIn.passkey();
    setBusy(false);
    if (result.error) {
      setMessage("Passkey 登录未完成，请重试或使用备用密码。");
      return;
    }
    window.location.assign(destination);
  }

  async function signInWithPassword(event: FormSubmitEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setBusy(false);
    if (result.error) {
      setMessage("邮箱或备用密码不正确。");
      return;
    }
    window.location.assign(destination);
  }

  return (
    <section className="login-panel" aria-labelledby="login-title">
      <p className="eyebrow">管理员入口</p>
      <h1 id="login-title">登录 Mirawind</h1>
      <p className="lede">优先使用已登记的 Passkey。</p>
      <button
        className="primary"
        disabled={busy}
        onClick={signInWithPasskey}
        type="button"
      >
        使用 Passkey 登录
      </button>

      <details>
        <summary>使用备用密码</summary>
        <form onSubmit={signInWithPassword}>
          <label>
            管理员邮箱
            <input
              autoComplete="username webauthn"
              name="email"
              required
              type="email"
            />
          </label>
          <label>
            备用密码
            <input
              autoComplete="current-password"
              minLength={16}
              name="password"
              required
              type="password"
            />
          </label>
          <button disabled={busy} type="submit">
            使用备用密码登录
          </button>
        </form>
      </details>
      {message && (
        <p aria-live="polite" className="message">
          {message}
        </p>
      )}
      <p className="recovery">
        本站不提供注册或网页找回；完全恢复只能在服务器终端执行。
      </p>
    </section>
  );
}
