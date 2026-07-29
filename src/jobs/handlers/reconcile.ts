import type Database from "better-sqlite3";

import {
  reconcileStorage,
  type StorageReconciliation,
} from "@/storage/reconcile";
import type { StorageLayout } from "@/storage/layout";

export function reconcileRuntimeStorage(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<StorageReconciliation> {
  return reconcileStorage(input);
}
