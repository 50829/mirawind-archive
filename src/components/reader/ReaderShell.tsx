import { BookSearch } from "./BookSearch.js";
import { readerBreadcrumbs, type ReaderTocLink } from "./navigation.js";
import { TableOfContents } from "./TableOfContents.js";

export interface ReaderOutlineLink {
  readonly blockId: string;
  readonly href: string;
  readonly level: number;
  readonly title: string;
}

const navigationScript = String.raw`
(() => {
  document.documentElement.classList.add("reader-enhanced");
  const restoreFocus = new WeakMap();
  const closeDrawer = (dialog) => {
    if (dialog instanceof HTMLDialogElement && dialog.open) dialog.close();
  };
  for (const trigger of document.querySelectorAll("[data-reader-drawer-trigger]")) {
    if (!(trigger instanceof HTMLButtonElement)) continue;
    const dialog = document.getElementById(trigger.getAttribute("aria-controls") || "");
    if (!(dialog instanceof HTMLDialogElement)) continue;
    trigger.addEventListener("click", () => {
      restoreFocus.set(dialog, trigger);
      trigger.setAttribute("aria-expanded", "true");
      dialog.showModal();
    });
    dialog.addEventListener("close", () => {
      trigger.setAttribute("aria-expanded", "false");
      restoreFocus.get(dialog)?.focus({ preventScroll: true });
    });
  }
  const breakpoint = window.matchMedia("(min-width: 48.001rem)");
  const closeAtDesktop = () => {
    if (!breakpoint.matches) return;
    for (const dialog of document.querySelectorAll("[data-reader-drawer]")) closeDrawer(dialog);
  };
  breakpoint.addEventListener("change", closeAtDesktop);
  closeAtDesktop();

  const focusHashTarget = () => {
    if (!window.location.hash) return;
    const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (!(target instanceof HTMLElement)) return;
    if (target.tabIndex < 0) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  };
  window.addEventListener("hashchange", focusHashTarget);
  if (window.location.hash) requestAnimationFrame(focusHashTarget);

  const outlineLinks = Array.from(document.querySelectorAll("a[data-outline-link]"));
  const outlineIds = Array.from(new Set(outlineLinks.map((link) => link.getAttribute("data-outline-link")).filter(Boolean)));
  const setOutlineLocation = (blockId) => {
    for (const link of outlineLinks) {
      if (link.getAttribute("data-outline-link") === blockId) {
        link.setAttribute("aria-current", "location");
      } else {
        link.removeAttribute("aria-current");
      }
    }
  };
  const updateOutlineLocation = () => {
    outlineScheduled = false;
    if (outlineIds.length === 0) return;
    const topbar = document.querySelector(".reader-topbar");
    const threshold = (topbar instanceof HTMLElement ? topbar.getBoundingClientRect().height : 64) + 24;
    let activeId = outlineIds[0];
    const hashId = window.location.hash ? decodeURIComponent(window.location.hash.slice(1)) : "";
    for (const blockId of outlineIds) {
      const heading = document.getElementById(blockId);
      if (!(heading instanceof HTMLElement)) continue;
      if (heading.getBoundingClientRect().top <= threshold) activeId = blockId;
      else break;
    }
    if (hashId && outlineIds.includes(hashId)) {
      const hashHeading = document.getElementById(hashId);
      if (hashHeading instanceof HTMLElement && hashHeading.getBoundingClientRect().top > threshold) activeId = hashId;
    }
    setOutlineLocation(activeId);
  };
  let outlineScheduled = false;
  const scheduleOutlineLocation = () => {
    if (outlineScheduled) return;
    outlineScheduled = true;
    requestAnimationFrame(updateOutlineLocation);
  };
  window.addEventListener("hashchange", scheduleOutlineLocation);
  window.addEventListener("resize", scheduleOutlineLocation);
  window.addEventListener("scroll", scheduleOutlineLocation, { passive: true });
  scheduleOutlineLocation();

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (document.querySelector("dialog[open]")) return;
    const path = event.composedPath();
    if (path.some((item) => {
      if (!(item instanceof HTMLElement)) return false;
      const tag = item.tagName;
      return ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "DETAILS", "CODE", "PRE"].includes(tag) ||
        item.isContentEditable ||
        item.hasAttribute("role") ||
        item.tabIndex >= 0 ||
        item.hasAttribute("data-reader-interactive");
    })) return;
    const selector = event.key === "ArrowLeft" ? "a[rel='prev']" : "a[rel='next']";
    const href = document.querySelector(selector)?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    window.location.assign(href);
  });
})();
`;

function PageOutline(props: {
  readonly outline: readonly ReaderOutlineLink[];
  readonly showHeading?: boolean;
}) {
  const baseLevel = Math.min(
    ...props.outline.map((heading) => heading.level),
    1,
  );
  return (
    <nav aria-label="本页提纲" className="reader-outline">
      {props.showHeading !== false && <h2>本页提纲</h2>}
      <ol>
        {props.outline.map((heading, index) => (
          <li
            key={heading.blockId}
            style={{
              marginInlineStart: `${Math.max(0, heading.level - baseLevel) * 0.7}rem`,
            }}
          >
            <a
              aria-current={index === 0 ? "location" : undefined}
              data-outline-link={heading.blockId}
              href={heading.href}
            >
              {heading.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function ReaderShell(props: {
  readonly bodyHtml: string;
  readonly bookKey: string;
  readonly bookTitle: string;
  readonly currentHeadingId: string | null;
  readonly currentPageId: number;
  readonly firstPageHref: string;
  readonly nextHref: string | null;
  readonly originalDownloads: readonly {
    readonly href: string;
    readonly label: string;
  }[];
  readonly outline: readonly ReaderOutlineLink[];
  readonly previousHref: string | null;
  readonly toc: readonly ReaderTocLink[];
}) {
  const breadcrumbs = readerBreadcrumbs(props.toc, props.currentHeadingId);
  return (
    <>
      <header className="reader-topbar">
        <a className="reader-library-link" href="/library">
          返回书库
        </a>
        <nav aria-label="当前位置" className="reader-breadcrumb">
          <a className="reader-book-title" href={props.firstPageHref}>
            {props.bookTitle}
          </a>
          {breadcrumbs.map((crumb, index) => (
            <span className="reader-breadcrumb-part" key={crumb.blockId}>
              <span aria-hidden="true" className="reader-breadcrumb-separator">
                ›
              </span>
              <a
                aria-current={
                  index === breadcrumbs.length - 1 ? "location" : undefined
                }
                href={crumb.href}
              >
                {crumb.title}
              </a>
            </span>
          ))}
        </nav>
        <div className="reader-desktop-tools">
          <BookSearch bookKey={props.bookKey} />
          {props.originalDownloads.map((download) => (
            <a download href={download.href} key={download.href} rel="nofollow">
              {download.label}
            </a>
          ))}
        </div>
      </header>
      <nav aria-label="阅读工具" className="reader-mobile-actions">
        {[
          ["reader-mobile-toc", "目录"],
          ["reader-mobile-outline", "本文"],
          ["reader-mobile-search", "搜索"],
          ["reader-mobile-downloads", "下载"],
        ].map(([id, label]) => (
          <button
            aria-controls={id}
            aria-expanded="false"
            data-reader-drawer-trigger
            key={id}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="reader-layout">
        <TableOfContents
          currentHeadingId={props.currentHeadingId}
          currentPageId={props.currentPageId}
          toc={props.toc}
        />
        <main className="reader-main" id="main-content">
          <article
            className="reader-document"
            dangerouslySetInnerHTML={{ __html: props.bodyHtml }}
          />
          <nav aria-label="翻页" className="reader-page-nav">
            {props.previousHref ? (
              <a href={props.previousHref} rel="prev">
                ← 上一页
              </a>
            ) : (
              <span />
            )}
            {props.nextHref ? (
              <a href={props.nextHref} rel="next">
                下一页 →
              </a>
            ) : (
              <span />
            )}
          </nav>
        </main>
        <PageOutline outline={props.outline} />
      </div>
      <dialog
        aria-labelledby="reader-mobile-toc-heading"
        data-reader-drawer
        id="reader-mobile-toc"
      >
        <div className="reader-drawer-heading">
          <h2 id="reader-mobile-toc-heading">目录</h2>
          <form method="dialog">
            <button type="submit">关闭</button>
          </form>
        </div>
        <TableOfContents
          currentHeadingId={props.currentHeadingId}
          currentPageId={props.currentPageId}
          showHeading={false}
          toc={props.toc}
        />
      </dialog>
      <dialog
        aria-labelledby="reader-mobile-outline-heading"
        data-reader-drawer
        id="reader-mobile-outline"
      >
        <div className="reader-drawer-heading">
          <h2 id="reader-mobile-outline-heading">本文</h2>
          <form method="dialog">
            <button type="submit">关闭</button>
          </form>
        </div>
        <PageOutline outline={props.outline} showHeading={false} />
      </dialog>
      <dialog
        aria-labelledby="reader-mobile-search-heading"
        data-reader-drawer
        id="reader-mobile-search"
      >
        <div className="reader-drawer-heading">
          <h2 id="reader-mobile-search-heading">搜索</h2>
          <form method="dialog">
            <button type="submit">关闭</button>
          </form>
        </div>
        <BookSearch bookKey={props.bookKey} />
      </dialog>
      <dialog
        aria-labelledby="reader-mobile-downloads-heading"
        data-reader-drawer
        id="reader-mobile-downloads"
      >
        <div className="reader-drawer-heading">
          <h2 id="reader-mobile-downloads-heading">下载</h2>
          <form method="dialog">
            <button type="submit">关闭</button>
          </form>
        </div>
        {props.originalDownloads.length > 0 ? (
          <ul>
            {props.originalDownloads.map((download) => (
              <li key={download.href}>
                <a download href={download.href} rel="nofollow">
                  {download.label}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>这本书没有可下载的原始文件。</p>
        )}
      </dialog>
      <script dangerouslySetInnerHTML={{ __html: navigationScript }} />
    </>
  );
}
