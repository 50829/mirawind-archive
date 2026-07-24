import { BookSearch } from "./BookSearch.js";
import { TableOfContents, type ReaderPageLink } from "./TableOfContents.js";

export interface ReaderOutlineLink {
  readonly href: string;
  readonly level: number;
  readonly title: string;
}

const navigationScript = String.raw`
(() => {
  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const target = event.target;
    if (target instanceof Element && target.closest("input, textarea, select, button, [contenteditable='true'], pre, code")) return;
    const selector = event.key === "ArrowLeft" ? "a[rel='prev']" : "a[rel='next']";
    const href = document.querySelector(selector)?.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    window.location.assign(href);
  });
})();
`;

export function ReaderShell(props: {
  readonly bodyHtml: string;
  readonly bookKey: string;
  readonly bookTitle: string;
  readonly currentPageId: number;
  readonly nextHref: string | null;
  readonly originalDownloads: readonly {
    readonly href: string;
    readonly label: string;
  }[];
  readonly outline: readonly ReaderOutlineLink[];
  readonly pages: readonly ReaderPageLink[];
  readonly previousHref: string | null;
}) {
  return (
    <>
      <header className="reader-topbar">
        <a href="/library">返回书库</a>
        <span className="reader-book-title">{props.bookTitle}</span>
        <BookSearch bookKey={props.bookKey} />
        {props.originalDownloads.map((download) => (
          <a download href={download.href} key={download.href} rel="nofollow">
            {download.label}
          </a>
        ))}
      </header>
      <div className="reader-layout">
        <TableOfContents
          currentPageId={props.currentPageId}
          pages={props.pages}
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
        <nav aria-label="本页提纲" className="reader-outline">
          <h2>本页</h2>
          <ol>
            {props.outline.map((heading) => (
              <li
                key={heading.href}
                style={{
                  marginInlineStart: `${(heading.level - 1) * 0.65}rem`,
                }}
              >
                <a href={heading.href}>{heading.title}</a>
              </li>
            ))}
          </ol>
        </nav>
      </div>
      <script dangerouslySetInnerHTML={{ __html: navigationScript }} />
    </>
  );
}
