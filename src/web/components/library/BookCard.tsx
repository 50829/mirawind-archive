import type { PublicLibraryEntry } from "@/modules/catalog/application/public";

export function BookCard({ entry }: { readonly entry: PublicLibraryEntry }) {
  const placeholder = [...entry.title.trim()][0]?.toLocaleUpperCase() ?? "书";
  return (
    <article className="library-card" data-book-id={entry.bookId}>
      <a
        aria-label={`开始阅读《${entry.title}》`}
        className="library-cover"
        href={entry.startUrl}
      >
        {entry.coverUrl ? (
          <img alt="" loading="lazy" src={entry.coverUrl} />
        ) : (
          <span aria-hidden="true" className="library-cover-placeholder">
            {placeholder}
          </span>
        )}
      </a>
      <div className="library-card-copy">
        <h2>
          <a href={entry.detailsUrl}>{entry.title}</a>
        </h2>
        {entry.authors.length > 0 ? (
          <p className="library-authors">{entry.authors.join("、")}</p>
        ) : null}
        <div className="library-card-actions">
          <a className="primary-action" href={entry.startUrl}>
            开始阅读
          </a>
          <a
            data-library-details
            href={entry.detailsUrl}
            id={`book-${entry.bookId}-details`}
          >
            查看详情
          </a>
        </div>
      </div>
    </article>
  );
}
