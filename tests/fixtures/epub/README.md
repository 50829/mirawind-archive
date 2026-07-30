# EPUB test fixtures

Administrator-provided real EPUB books are private local test inputs. Keep raw `.epub`
files directly in this directory or under the ignored `real/` directory; Git must never
track them or extracted book content.

Do not extract EPUB files manually. Future import tests must exercise the original archive
and treat its entries, package metadata, XHTML, styles, fonts and resources as hostile
input. A tracked synthetic fixture set and a local hash-bound real-fixture manifest will be
added with the EPUB import feature; until then, these books are exploratory inputs rather
than release evidence.
