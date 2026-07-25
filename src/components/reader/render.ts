import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ReaderShell } from "./ReaderShell.js";

export const readerShellCss = `
:root{color-scheme:light;--reader-border:#d9dfdf;--reader-muted:#5c6864;--reader-bg:#f5f6f3;--reader-accent:#24614c;--reader-paper:#fff}
*{box-sizing:border-box}
html{scroll-padding-top:5rem}
body{margin:0;color:#17231f;background:var(--reader-paper);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.65}
a:focus-visible,button:focus-visible,input:focus-visible{outline:3px solid #bf6036;outline-offset:3px}
.reader-topbar{position:sticky;z-index:20;top:0;display:flex;align-items:center;gap:1rem;min-height:4rem;padding:.65rem 1.25rem;border-bottom:1px solid var(--reader-border);background:rgba(255,255,255,.96);backdrop-filter:blur(12px)}
.reader-topbar>a,.reader-desktop-tools>a{color:var(--reader-accent);text-decoration:none}.reader-book-title{overflow:hidden;flex:1;font-weight:650;text-overflow:ellipsis;white-space:nowrap}
.reader-desktop-tools{display:flex;align-items:center;gap:.8rem}
.reader-mobile-actions{display:none}
.reader-layout{display:grid;grid-template-columns:minmax(13rem,18rem) minmax(0,52rem) minmax(12rem,16rem);gap:2rem;max-width:92rem;margin:0 auto;padding:2rem 1.25rem}
.reader-toc,.reader-outline{position:sticky;top:6rem;max-height:calc(100vh - 7rem);overflow:auto;align-self:start}
.reader-toc h2,.reader-outline h2{font-size:.9rem;text-transform:uppercase;letter-spacing:.08em;color:var(--reader-muted)}
.reader-toc ol,.reader-outline ol{padding:0;list-style:none}.reader-toc a,.reader-outline a{display:block;padding:.35rem .5rem;border-radius:.35rem;color:#334155;text-decoration:none}.reader-toc a[aria-current="page"]{color:var(--reader-accent);background:#eaf1fb;font-weight:650}
.reader-main{min-width:0}.reader-document{font-family:ui-serif,Georgia,"Noto Serif CJK SC",serif}.reader-document img{max-width:100%;height:auto}.reader-document table{display:block;max-width:100%;overflow:auto;border-collapse:collapse}.reader-document th,.reader-document td{padding:.45rem;border:1px solid var(--reader-border)}.reader-document [id]:focus{outline:3px solid #bf6036;outline-offset:.3rem}
.reader-page-nav{display:flex;justify-content:space-between;gap:1rem;margin-top:4rem;padding-top:1.25rem;border-top:1px solid var(--reader-border)}.reader-page-nav a{color:var(--reader-accent)}
.book-search{position:relative}.book-search form{display:flex;gap:.4rem}.book-search input{width:min(18rem,50vw);padding:.45rem .6rem}.book-search [data-search-results]{position:absolute;right:0;width:min(30rem,90vw);max-height:65vh;overflow:auto;margin:.5rem 0;padding:1rem 1rem 1rem 2rem;border:1px solid var(--reader-border);background:#fff;box-shadow:0 1rem 3rem rgba(15,23,42,.14)}.book-search [data-search-results]:empty{display:none}.book-search [data-search-results] p{margin:.25rem 0 1rem;color:var(--reader-muted)}
.reader-mobile-actions button,.reader-drawer-heading button{min-height:2.75rem;padding:.55rem .8rem;border:1px solid var(--reader-border);border-radius:.55rem;color:#17231f;background:#fff;font:inherit}
dialog[data-reader-drawer]{width:min(34rem,calc(100vw - 1.5rem));max-height:calc(100vh - 1.5rem);padding:1.25rem;border:0;border-radius:1rem;color:#17231f;background:#fff;box-shadow:0 2rem 6rem rgba(16,26,22,.3)}
dialog[data-reader-drawer]::backdrop{background:rgba(15,24,21,.55);backdrop-filter:blur(5px)}
.reader-drawer-heading{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--reader-border)}.reader-drawer-heading h2{margin:.4rem 0 1rem}
dialog[data-reader-drawer] .reader-toc{position:static;max-height:none}dialog[data-reader-drawer] ol,dialog[data-reader-drawer] ul{padding-left:1.4rem}dialog[data-reader-drawer] li{margin:.55rem 0}dialog[data-reader-drawer] .book-search form{display:grid;grid-template-columns:minmax(0,1fr) auto}dialog[data-reader-drawer] .book-search input{width:100%}dialog[data-reader-drawer] .book-search [data-search-results]{position:static;width:100%;max-height:none;box-shadow:none}
.visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:70rem){.reader-layout{grid-template-columns:minmax(12rem,16rem) minmax(0,1fr)}.reader-outline{position:static;grid-column:2}}
@media(max-width:48rem){.reader-topbar{flex-wrap:wrap}.reader-desktop-tools{width:100%;flex-wrap:wrap}.reader-layout{display:block;padding-top:1rem}.reader-toc,.reader-outline{position:static;max-height:none;margin-bottom:2rem}.book-search{width:100%}.book-search form{width:100%}.book-search input{width:100%}.reader-enhanced .reader-desktop-tools{display:none}.reader-enhanced .reader-mobile-actions{position:sticky;z-index:19;top:4rem;display:grid;grid-template-columns:repeat(4,1fr);gap:.35rem;padding:.5rem;border-bottom:1px solid var(--reader-border);background:rgba(245,246,243,.97)}.reader-enhanced .reader-layout>.reader-toc,.reader-enhanced .reader-layout>.reader-outline{display:none}.reader-enhanced .reader-layout{padding-top:1.5rem}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`;

export function renderReaderShell(
  props: Parameters<typeof ReaderShell>[0],
): string {
  return renderToStaticMarkup(createElement(ReaderShell, props));
}
