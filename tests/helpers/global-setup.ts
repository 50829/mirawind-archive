import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export async function ensureTestDataRoot(
  relativePath = "test-results/runtime-data",
): Promise<string> {
  const dataRoot = resolve(relativePath);
  await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  return dataRoot;
}

export default async function globalSetup(): Promise<void> {
  await ensureTestDataRoot("test-results/playwright-data");
}
