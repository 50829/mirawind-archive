const storageKey = "mirawind.library-context.v1";
const maximumContextAgeMs = 10 * 60 * 1_000;

export interface LibraryContext {
  readonly detailPath: string;
  readonly openerId: string;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly sourcePath: string;
  readonly timestampMs: number;
}

function pathAtOrigin(value: string, origin: string): string | null {
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

export function createLibraryContext(input: {
  readonly detailPath: string;
  readonly nowMs: number;
  readonly openerId: string;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly sourcePath: string;
}): LibraryContext {
  const origin = "https://mirawind.invalid";
  const sourcePath = pathAtOrigin(input.sourcePath, origin);
  const detailPath = pathAtOrigin(input.detailPath, origin);
  if (
    !sourcePath?.startsWith("/library") ||
    !detailPath?.startsWith("/books/") ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,119}$/u.test(input.openerId) ||
    !Number.isFinite(input.scrollX) ||
    !Number.isFinite(input.scrollY) ||
    input.scrollX < 0 ||
    input.scrollY < 0 ||
    !Number.isSafeInteger(input.nowMs) ||
    input.nowMs < 0
  ) {
    throw new Error("LIBRARY_CONTEXT_INVALID");
  }
  return Object.freeze({
    detailPath,
    openerId: input.openerId,
    scrollX: input.scrollX,
    scrollY: input.scrollY,
    sourcePath,
    timestampMs: input.nowMs,
  });
}

export function parseLibraryContext(
  json: string | null,
  input: {
    readonly currentOrigin: string;
    readonly detailPath: string;
    readonly nowMs: number;
  },
): LibraryContext | null {
  if (!json || json.length > 2_000) return null;
  try {
    const parsed = JSON.parse(json) as Readonly<Record<string, unknown>>;
    const context = createLibraryContext({
      detailPath: String(parsed.detailPath),
      nowMs: Number(parsed.timestampMs),
      openerId: String(parsed.openerId),
      scrollX: Number(parsed.scrollX),
      scrollY: Number(parsed.scrollY),
      sourcePath: String(parsed.sourcePath),
    });
    const requestedDetail = pathAtOrigin(input.detailPath, input.currentOrigin);
    if (
      requestedDetail !== context.detailPath ||
      input.nowMs < context.timestampMs ||
      input.nowMs - context.timestampMs > maximumContextAgeMs
    ) {
      return null;
    }
    return context;
  } catch {
    return null;
  }
}

function storedContext(detailPath: string): LibraryContext | null {
  return parseLibraryContext(sessionStorage.getItem(storageKey), {
    currentOrigin: window.location.origin,
    detailPath,
    nowMs: Date.now(),
  });
}

export function installDetailsNavigation(): () => void {
  const abort = new AbortController();
  const { signal } = abort;
  document
    .querySelectorAll<HTMLAnchorElement>("[data-library-details]")
    .forEach((link, index) => {
      if (!link.id) link.id = `book-details-opener-${index + 1}`;
      link.addEventListener(
        "click",
        () => {
          try {
            const context = createLibraryContext({
              detailPath: `${link.pathname}${link.search}`,
              nowMs: Date.now(),
              openerId: link.id,
              scrollX: window.scrollX,
              scrollY: window.scrollY,
              sourcePath: `${window.location.pathname}${window.location.search}`,
            });
            sessionStorage.setItem(storageKey, JSON.stringify(context));
          } catch {
            sessionStorage.removeItem(storageKey);
          }
        },
        { signal },
      );
    });

  const restoreLibraryContext = () => {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return;
    let parsed: Readonly<Record<string, unknown>>;
    try {
      parsed = JSON.parse(raw) as Readonly<Record<string, unknown>>;
    } catch {
      sessionStorage.removeItem(storageKey);
      return;
    }
    const context = parseLibraryContext(raw, {
      currentOrigin: window.location.origin,
      detailPath: String(parsed.detailPath),
      nowMs: Date.now(),
    });
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (!context || currentPath !== context.sourcePath) return;
    sessionStorage.removeItem(storageKey);
    requestAnimationFrame(() => {
      window.scrollTo(context.scrollX, context.scrollY);
      document.getElementById(context.openerId)?.focus({ preventScroll: true });
    });
  };
  window.addEventListener("pageshow", restoreLibraryContext, { signal });

  const dialog = document.querySelector<HTMLDialogElement>(
    "[data-book-details-dialog]",
  );
  if (dialog) {
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (dialog.open) dialog.close();
    dialog.showModal();
    const close = () => {
      const context = storedContext(currentPath);
      if (context && window.history.length > 1) {
        window.history.back();
      } else {
        window.location.assign("/library");
      }
    };
    dialog.addEventListener(
      "cancel",
      (event) => {
        event.preventDefault();
        close();
      },
      { signal },
    );
    dialog
      .querySelectorAll<HTMLAnchorElement>("[data-details-close]")
      .forEach((link) =>
        link.addEventListener(
          "click",
          (event) => {
            event.preventDefault();
            close();
          },
          { signal },
        ),
      );
  }
  return () => abort.abort();
}
