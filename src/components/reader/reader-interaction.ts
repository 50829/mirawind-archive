export interface ReaderArrowEvent {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly defaultPrevented: boolean;
  readonly isComposing: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}

export interface ReaderArrowPathItem {
  readonly contentEditable?: string;
  readonly interactive?: boolean;
  readonly role?: string | null;
  readonly tabIndex?: number;
  readonly tagName?: string;
}

const interactiveTags = new Set([
  "A",
  "BUTTON",
  "CODE",
  "DETAILS",
  "INPUT",
  "PRE",
  "SELECT",
  "SUMMARY",
  "TEXTAREA",
]);

export function shouldNavigateWithArrowKey(input: {
  readonly dialogOpen: boolean;
  readonly event: ReaderArrowEvent;
  readonly path: readonly ReaderArrowPathItem[];
}): boolean {
  const event = input.event;
  if (
    input.dialogOpen ||
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
  ) {
    return false;
  }
  return !input.path.some(
    (item) =>
      (item.tagName && interactiveTags.has(item.tagName.toUpperCase())) ||
      item.contentEditable === "true" ||
      Boolean(item.role) ||
      (typeof item.tabIndex === "number" && item.tabIndex >= 0) ||
      item.interactive === true,
  );
}
