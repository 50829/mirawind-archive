import { parseEnvironment } from "@/config/environment";
import {
  createStorageLayout,
  type StorageLayout,
} from "@/platform/filesystem/layout";

let runtimeLayout: Promise<StorageLayout> | undefined;

function runtimeMode(): "development" | "production" | "test" {
  if (process.env.NODE_ENV === "production") return "production";
  if (process.env.NODE_ENV === "test") return "test";
  return "development";
}

export function getRuntimeEnvironment() {
  return parseEnvironment(process.env, { mode: runtimeMode() });
}

export function getRuntimeStorageLayout(): Promise<StorageLayout> {
  runtimeLayout ??= createStorageLayout(getRuntimeEnvironment().dataDirectory);
  return runtimeLayout;
}

export function resetRuntimeStorageForTests(): void {
  runtimeLayout = undefined;
}
