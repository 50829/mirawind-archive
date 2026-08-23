export interface BookRemovalInventory {
  readonly importIds: readonly string[];
  readonly jobIds: readonly string[];
}

export interface BookWorkCancellationPort {
  cancelBookWork(input: {
    readonly bookId: number;
    readonly cleanupJobId: string;
    readonly nowMs: number;
  }): void;
}

export interface BookRemovalInventoryPort {
  captureRemovalInventory(bookId: number): BookRemovalInventory;
}

export interface BookPublishingRecordPurgePort {
  purgeBookRecords(input: {
    readonly bookId: number;
    readonly cleanupJobId: string;
  }): void;
}

export interface BookDeletionTaskPort {
  createPurgeTask(input: { readonly bookId: number; readonly nowMs: number }): {
    readonly id: string;
  };
}
