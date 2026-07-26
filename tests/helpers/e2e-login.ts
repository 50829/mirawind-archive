import { expect, type Page } from "@playwright/test";

import { e2eAdministrator } from "./global-setup.js";

export async function loginAsAdministrator(
  page: Page,
  clientAddress: string,
): Promise<void> {
  await page.context().setExtraHTTPHeaders({
    "x-real-ip": clientAddress,
  });
  await page.goto("/login");
  await page.getByText("使用备用密码", { exact: true }).click();
  await page.getByLabel("管理员邮箱").fill(e2eAdministrator.email);
  await page.getByLabel("备用密码").fill(e2eAdministrator.password);
  await page.getByRole("button", { name: "使用备用密码登录" }).click();
  await expect(page).toHaveURL(/\/manage$/u);
}
