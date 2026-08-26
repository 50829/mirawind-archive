import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LoginPanel } from "@/web/components/auth/LoginPanel";

describe("administrator login panel", () => {
  it("supports credential autofill and explains the persistent session", () => {
    const html = renderToStaticMarkup(<LoginPanel nextPath="/manage" />);

    expect(html).toContain('autoComplete="username webauthn"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain("登录后在此设备保持登录 90 天");
  });
});
