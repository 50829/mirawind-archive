import type { BookDetails as BookDetailsView } from "@/modules/catalog/application/catalog-api";

function formatBytes(value: number): string {
  if (value < 1_000) return `${value} B`;
  if (value < 1_000_000) {
    return `${Math.round((value / 1_000) * 10) / 10} KB`;
  }
  return `${Math.round((value / 1_000_000) * 10) / 10} MB`;
}

export function BookDetails({
  closeHref,
  details,
}: {
  readonly closeHref: string;
  readonly details: BookDetailsView;
}) {
  const placeholder = [...details.title.trim()][0]?.toLocaleUpperCase() ?? "书";
  const tocPreview = details.toc.slice(0, 16);
  const tocIsTruncated = details.tocEntryCount > tocPreview.length;
  return (
    <dialog
      aria-labelledby="book-details-title"
      className="book-details-dialog"
      data-book-details-dialog
      open
    >
      <article className="book-details">
        <div className="book-details-intro">
          <div aria-hidden="true" className="book-details-cover">
            <span>{placeholder}</span>
            {details.coverUrl ? (
              <img alt="" decoding="async" src={details.coverUrl} />
            ) : null}
          </div>
          <header>
            <div>
              <p className="eyebrow">BOOK DETAILS</p>
              <h1 id="book-details-title">{details.title}</h1>
              {details.subtitle ? (
                <p className="book-details-subtitle">{details.subtitle}</p>
              ) : null}
            </div>
            <a
              aria-label="关闭图书详情"
              className="details-close"
              data-details-close
              href={closeHref}
            >
              关闭
            </a>
          </header>
        </div>
        {details.authors.length > 0 ? (
          <p className="book-details-authors">{details.authors.join("、")}</p>
        ) : null}
        <div className="details-actions">
          <a className="primary-action" href={details.startUrl}>
            开始阅读
          </a>
          <a href={closeHref}>返回书库</a>
        </div>
        {details.description ? (
          <section aria-labelledby="details-description-heading">
            <h2 id="details-description-heading">关于本书</h2>
            <p className="details-description">{details.description}</p>
          </section>
        ) : null}
        {details.language || details.contributors.length > 0 ? (
          <dl className="details-metadata">
            {details.language ? (
              <>
                <dt>语言</dt>
                <dd>{details.language}</dd>
              </>
            ) : null}
            {details.contributors.length > 0 ? (
              <>
                <dt>其他贡献者</dt>
                <dd>{details.contributors.join("、")}</dd>
              </>
            ) : null}
          </dl>
        ) : null}
        {details.originals.length > 0 ? (
          <section aria-labelledby="details-downloads-heading">
            <h2 id="details-downloads-heading">下载</h2>
            <ul className="details-downloads">
              {details.originals.map((original) => (
                <li key={original.href}>
                  <a href={original.href}>{original.label}</a>
                  <span>
                    {original.mediaType} · {formatBytes(original.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section aria-labelledby="details-toc-heading">
          <div className="details-section-heading">
            <h2 id="details-toc-heading">目录</h2>
            {tocIsTruncated ? (
              <span>
                显示前 {tocPreview.length} / {details.tocEntryCount} 项
              </span>
            ) : null}
          </div>
          {tocPreview.length > 0 ? (
            <ol className="details-toc">
              {tocPreview.map((node, index) => (
                <li
                  key={`${node.href}:${index}`}
                  style={{ "--toc-level": node.level } as React.CSSProperties}
                >
                  <a href={node.href}>
                    {node.number ? <span>{node.number}</span> : null}
                    {node.title}
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p>这本书没有单独的目录项，可以直接开始阅读。</p>
          )}
          {tocIsTruncated ? (
            <a className="details-full-toc" href={details.startUrl}>
              在阅读器中查看完整目录
            </a>
          ) : null}
        </section>
      </article>
    </dialog>
  );
}
