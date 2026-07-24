import type Database from "better-sqlite3";

import {
  reconcileStorage,
  type StorageReconciliation,
} from "../../storage/reconcile.js";
import type { StorageLayout } from "../../storage/layout.js";

export function reconcileRuntimeStorage(input: {
  readonly database: Database.Database;
  readonly layout: StorageLayout;
  readonly nowMs: number;
}): Promise<StorageReconciliation> {
  return reconcileStorage(input);
}
