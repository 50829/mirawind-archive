import { expect, test } from "@playwright/test";

import { loginAsAdministrator } from "../helpers/e2e-login.js";

test("authorizes management routes and keeps their responses private", async ({
  page,
}) => {
  await loginAsAdministrator(page, "192.0.2.19");
  const library = await page.request.get("/api/manage/library?limit=1");
  const body = (await library.json()) as { entries: { book_id: number }[] };
  const book = body.entries.at(0);
  if (!book) throw new Error("MANAGED_BOOK_MISSING");

  for (const path of [
    "/manage",
    "/manage/tasks",
    "/manage/security",
    `/manage/books/${book.book_id}`,
  ]) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
  }
  expect((await page.request.get("/manage/books/999999999")).status()).toBe(
    404,
  );
  const capability = await page.request.get(
    "/api/library/management-capability",
  );
  expect(capability.status()).toBe(200);
  expect(capability.headers()["cache-control"]).toBe("private, no-store");
  expect(await capability.json()).toEqual({ management_available: true });
});
