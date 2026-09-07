import type { PublicLibraryView } from "@/modules/catalog/application/catalog-api";
import { BookCard } from "./BookCard";

export function LibraryScene({
  library,
}: {
  readonly library: PublicLibraryView;
}) {
  return (
    <section aria-labelledby="library-heading" className="library-scene">
      <header className="library-heading">
        <div>
          <h1 id="library-heading">书库</h1>
        </div>
      </header>
      {library.hasUnavailableBooks ? (
        <p className="library-notice" role="status">
          部分图书暂时无法显示，请稍后再试。
        </p>
      ) : null}
      {library.entries.length === 0 ? (
        <div className="library-empty">
          <h2>暂无公开图书</h2>
        </div>
      ) : (
        <div className="library-grid">
          {library.entries.map((entry) => (
            <BookCard entry={entry} key={entry.bookId} />
          ))}
        </div>
      )}
    </section>
  );
}
