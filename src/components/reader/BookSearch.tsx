const searchScript = String.raw`
(() => {
  for (const container of document.querySelectorAll("[data-book-search-container]")) {
    if (!(container instanceof HTMLElement) || container.dataset.searchInitialized === "true") continue;
    const form = container.querySelector("[data-book-search]");
    const output = container.querySelector("[data-search-results]");
    const notice = container.querySelector("[data-search-notice]");
    if (!(form instanceof HTMLFormElement) || !(output instanceof HTMLOListElement) || !(notice instanceof HTMLElement)) continue;
    container.dataset.searchInitialized = "true";
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const query = new FormData(form).get("q");
      if (typeof query !== "string" || !query.trim()) return;
      output.replaceChildren();
      notice.textContent = "正在搜索…";
      try {
        const endpoint = new URL(form.dataset.endpoint || "", window.location.origin);
        endpoint.searchParams.set("q", query);
        const response = await fetch(endpoint, { credentials: "same-origin" });
        if (!response.ok) throw new Error("SEARCH_FAILED");
        const payload = await response.json();
        notice.textContent = payload.notice || (payload.results.length ? "" : "没有匹配结果。");
        for (const result of payload.results) {
          const item = document.createElement("li");
          const link = document.createElement("a");
          const snippet = document.createElement("p");
          link.href = String(result.href);
          link.textContent = String(result.title);
          snippet.textContent = String(result.snippet);
          item.append(link, snippet);
          output.append(item);
        }
      } catch {
        notice.textContent = "搜索暂时不可用，请稍后重试。";
      }
    });
  }
})();
`;

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
      <script dangerouslySetInnerHTML={{ __html: searchScript }} />
    </section>
  );
}
