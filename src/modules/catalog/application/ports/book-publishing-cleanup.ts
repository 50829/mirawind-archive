export interface BookRemovalInventory {
  readonly importIds: readonly string[];
  readonly jobIds: readonly string[];
}

export interface BookPublishingCleanupPort {
  cancelBookWork(input: {
    readonly bookId: number;
    readonly cleanupJobId: string;
    readonly nowMs: number;
  }): void;
  captureRemovalInventory(bookId: number): BookRemovalInventory;
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
