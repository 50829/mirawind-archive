import { BookSearch } from "@/components/reader/BookSearch";
import {
  readerBreadcrumbs,
  type ReaderTocLink,
} from "@/components/reader/navigation";
import { TableOfContents } from "@/components/reader/TableOfContents";
import { readerScriptUrl } from "@/styles/assets";

export interface ReaderOutlineLink {
  readonly blockId: string;
  readonly href: string;
  readonly level: number;
  readonly title: string;
}

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

export interface ReaderPageModel {
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
  readonly previewRevision?: number;
  readonly toc: readonly ReaderTocLink[];
  readonly mode?: "preview" | "published";
}

export function ReaderShell(props: ReaderPageModel) {
  const breadcrumbs = readerBreadcrumbs(props.toc, props.currentHeadingId);
  const published = props.mode !== "preview";
  return (
    <>
      <a className="reader-skip-link" href="#main-content">
        跳到正文
      </a>
      <header
        className="reader-topbar"
        data-preview-revision={
          props.mode === "preview" ? props.previewRevision : undefined
        }
        data-reader-mode={props.mode ?? "published"}
        data-reader-page-id={props.currentPageId}
      >
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
        {published && (
          <div className="reader-desktop-tools">
            <BookSearch bookKey={props.bookKey} />
            {props.originalDownloads.map((download) => (
              <a
                download
                href={download.href}
                key={download.href}
                rel="nofollow"
              >
                {download.label}
              </a>
            ))}
          </div>
        )}
      </header>
      <nav aria-label="阅读工具" className="reader-mobile-actions">
        {[
          ["reader-mobile-toc", "目录"],
          ["reader-mobile-outline", "本文"],
          ...(published
            ? ([
                ["reader-mobile-search", "搜索"],
                ["reader-mobile-downloads", "下载"],
              ] as const)
            : []),
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
      {published && (
        <>
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
        </>
      )}
      <script defer src={readerScriptUrl} />
    </>
  );
}
