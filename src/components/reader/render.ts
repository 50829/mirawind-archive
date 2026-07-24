import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReaderShell } from "./ReaderShell.js";

export const readerShellCss = `
:root{color-scheme:light;--reader-border:#dde3ea;--reader-muted:#5f6b7a;--reader-bg:#f7f9fb;--reader-accent:#2457a6}
*{box-sizing:border-box}
html{scroll-padding-top:5rem}
body{margin:0;color:#172033;background:#fff;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.65}
.reader-topbar{position:sticky;z-index:20;top:0;display:flex;align-items:center;gap:1rem;min-height:4rem;padding:.65rem 1.25rem;border-bottom:1px solid var(--reader-border);background:rgba(255,255,255,.96);backdrop-filter:blur(12px)}
.reader-topbar>a{color:var(--reader-accent);text-decoration:none}.reader-book-title{overflow:hidden;flex:1;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
.reader-layout{display:grid;grid-template-columns:minmax(13rem,18rem) minmax(0,52rem) minmax(12rem,16rem);gap:2rem;max-width:92rem;margin:0 auto;padding:2rem 1.25rem}
.reader-toc,.reader-outline{position:sticky;top:6rem;max-height:calc(100vh - 7rem);overflow:auto;align-self:start}
.reader-toc h2,.reader-outline h2{font-size:.9rem;text-transform:uppercase;letter-spacing:.08em;color:var(--reader-muted)}
.reader-toc ol,.reader-outline ol{padding:0;list-style:none}.reader-toc a,.reader-outline a{display:block;padding:.35rem .5rem;border-radius:.35rem;color:#334155;text-decoration:none}.reader-toc a[aria-current="page"]{color:var(--reader-accent);background:#eaf1fb;font-weight:650}
.reader-main{min-width:0}.reader-document{font-family:ui-serif,Georgia,"Noto Serif CJK SC",serif}.reader-document img{max-width:100%;height:auto}.reader-document table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}.reader-document th,.reader-document td{padding:.45rem;border:1px solid var(--reader-border)}
.reader-page-nav{display:flex;justify-content:space-between;gap:1rem;margin-top:4rem;padding-top:1.25rem;border-top:1px solid var(--reader-border)}.reader-page-nav a{color:var(--reader-accent)}
.book-search{position:relative}.book-search form{display:flex;gap:.4rem}.book-search input{width:min(18rem,50vw);padding:.45rem .6rem}.book-search [data-search-results]{position:absolute;right:0;width:min(30rem,90vw);max-height:65vh;overflow:auto;margin:.5rem 0;padding:1rem 1rem 1rem 2rem;border:1px solid var(--reader-border);background:#fff;box-shadow:0 1rem 3rem rgba(15,23,42,.14)}.book-search [data-search-results]:empty{display:none}.book-search [data-search-results] p{margin:.25rem 0 1rem;color:var(--reader-muted)}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:70rem){.reader-layout{grid-template-columns:minmax(12rem,16rem) minmax(0,1fr)}.reader-outline{display:none}}
@media(max-width:48rem){.reader-topbar{flex-wrap:wrap}.reader-layout{display:block;padding-top:1rem}.reader-toc{position:static;max-height:none;margin-bottom:2rem}.book-search{width:100%}.book-search form{width:100%}.book-search input{width:100%}}
`;

export function renderReaderShell(
  props: Parameters<typeof ReaderShell>[0],
): string {
  return renderToStaticMarkup(createElement(ReaderShell, props));
}
