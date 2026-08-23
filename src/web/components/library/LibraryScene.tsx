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
          <p className="eyebrow">MIRAWIND LIBRARY</p>
          <h1 id="library-heading">书库</h1>
        </div>
        <p>从一本书开始，沿着章节、搜索与引用继续阅读。</p>
      </header>
      {library.hasUnavailableBooks ? (
        <p className="library-notice" role="status">
          部分图书暂时无法显示，请稍后再试。
        </p>
      ) : null}
      {library.entries.length === 0 ? (
        <div className="library-empty">
          <h2>书库还是空的</h2>
          <p>第一本公开图书发布后，会在这里出现。</p>
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
