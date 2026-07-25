# Interaction contract: Library and Reading Loop

## Public library

- Every card is a semantic article with one heading.
- The cover or placeholder is an ordinary link to `start_url`.
- The title/details action is an ordinary link to `/books/:bookKey`.
- Missing optional metadata produces no empty label.
- A partial-unavailable notice reveals no omitted book count or identity.
- The homepage contains an ordinary “查看书库” link to `/library`.

## Route-driven details

- Direct `/books/:bookKey` HTML contains the full library backdrop and one `<dialog open>`
  named by its visible book title.
- The dialog contains ordinary start-reading, TOC, download and close links.
- When enhancement initializes, it converts the open dialog to `showModal()` so the browser
  supplies modal focus and inert-background behavior.
- Before navigating from library to details, enhancement stores only the source path,
  scroll coordinates, opener ID, detail path and a short timestamp in `sessionStorage`.
- Close/Escape/Back uses browser history only when exact same-origin paths and fresh context
  match. Otherwise close goes to `/library`.
- `pageshow` restores scroll and opener focus once, then removes the context.

## Reader

- Desktop keeps the fixed top bar, left full-book TOC, central document and right page
  outline.
- Narrow layouts expose buttons named “目录”, “本文”, “搜索” and “下载”; each names its
  controlled native dialog through `aria-controls` and reports open state.
- Closing a drawer by its close control or Escape restores the trigger focus and releases
  document scrolling.
- Without enhancement, the same bounded navigation/search/download content remains in
  normal semantic flow and every page link works.
- Crossing the responsive breakpoint closes any open mobile drawer safely.

## Keyboard

Left/right page navigation does nothing when:

- the event is prevented, composing, or has a modifier;
- any dialog is open;
- the composed target path contains a link, button, input, select, textarea, summary,
  details, code or preformatted content;
- the target is editable, role-bearing, focusable, or marked `data-reader-interactive`.

The feature does not add swipe pagination. Search, outline, internal and TOC destinations
remain ordinary canonical `href` values with block fragments.

## Publication outcome

- Queued/running phases use a fixed reader-facing label map.
- Canonical “查看图书”, “开始阅读” and “返回书库” actions appear only after the job state is
  `succeeded`.
- Failed, interrupted, canceled and stale outcomes state that the previous version remains
  live and link only to valid preview, task, retry or previous-version destinations.

## Accessibility gate

- Every introduced control has a visible label and focus indication.
- Dialogs have visible headings and do not use the full complex body as `aria-describedby`.
- Reduced-motion preference removes nonessential motion.
- Desktop and 360-pixel mobile primary journeys have no serious or critical automated
  accessibility finding and pass explicit focus/Escape/scroll-restoration assertions.
