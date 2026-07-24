export interface ReaderPageLink {
  readonly href: string;
  readonly pageId: number;
  readonly title: string;
}

export function TableOfContents(props: {
  readonly currentPageId: number;
  readonly pages: readonly ReaderPageLink[];
}) {
  return (
    <nav aria-label="全书目录" className="reader-toc">
      <h2>目录</h2>
      <ol>
        {props.pages.map((page) => (
          <li key={page.pageId}>
            <a
              aria-current={
                page.pageId === props.currentPageId ? "page" : undefined
              }
              href={page.href}
            >
              {page.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
