export function BookSearch(props: { readonly bookKey: string }) {
  return (
    <section
      aria-label="书内搜索"
      className="book-search"
      data-book-search-container
    >
      <form
        data-book-search
        data-endpoint={`/api/books/${props.bookKey}/search`}
        role="search"
      >
        <label>
          <span className="visually-hidden">搜索本书</span>
          <input
            autoComplete="off"
            maxLength={200}
            name="q"
            placeholder="搜索本书"
            required
            type="search"
          />
        </label>
        <button type="submit">搜索</button>
      </form>
      <p aria-live="polite" data-search-notice />
      <ol data-search-results />
    </section>
  );
}
