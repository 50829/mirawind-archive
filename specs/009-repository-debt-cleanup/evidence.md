# Evidence: Repository Debt Cleanup

## Pre-Implementation Baseline

Recorded on 2026-07-31 at `b82aca5` before source changes:

- Focused deletion and recovery integration tests: 30/30 passed.
- Architecture tests: 13/13 passed.
- Canonical product-source imports: zero replacements required.
- Dependency graph: 236 files, zero diagnostics.

Protected local inputs were present and remain outside the feature commit: `.env`, ignored MinerU and
EPUB fixtures, and the three pre-existing untracked `docs/research/` documents.

## Implemented Ownership Boundaries

Completed 009 source implementation:

- the production baseline and worker protocol use `reclaim_versions` and `purge_book`;
- `jobs.book_id` is the authoritative scope after import-to-book assignment;
- Catalog deletion code no longer writes Publishing tables, and `JobRepository` no longer reads or
  writes `book_deletions` or `draft_candidates`;
- candidate and deletion terminal/retry state is coordinated with its job in one immediate
  transaction through owner-specific use cases;
- `BookPresentationRepository` is the only SQLite insert and version-scoped mutation path for
  `book_version_presentations`; bulk book deletion remains Catalog-owned;
- retained-version reclamation removes projections through that Catalog repository rather than
  issuing Catalog-owned SQL from Publishing;
- the partial test schema, missing-table production fallbacks, two unreferenced production files,
  obsolete type forwarders and directly evidenced internal-only exports were removed;
- live CPU timing assertions were removed from the parallel unit suite; deterministic correctness
  checks and explicit benchmark commands remain.

## Final Automated Evidence

Run on 2026-07-31:

| Check                                             | Result                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                  | 399 files, zero errors/warnings                                                               |
| `pnpm lint`                                       | canonical imports zero replacements; 238-file graph, zero diagnostics; ESLint/style passed    |
| `pnpm test`                                       | 116 files, 640/640 tests passed in 5.75 s on the final rerun                                  |
| `pnpm test:contract`                              | 12 files, 45/45 passed                                                                        |
| focused recovery/deletion/publication integration | 18 files, 75/75 passed                                                                        |
| `pnpm build`                                      | Astro server and Web/worker/process bundles passed                                            |
| focused Playwright on port 4322                   | worker recovery passed; registered real-loop case skipped by its existing local-run condition |

The final ownership convergence also passed the focused retained-version reclamation integration
test, typecheck, lint/architecture checks and the complete automated suite.

The real-loop behavior was exercised independently by the production pipeline benchmark below.

## Content and Performance Evidence

The existing complete comparator finished in 1.36 s: all fifteen registered reference-v2 outcomes
were exact with zero issues.

One B-only production pipeline run selected the established small, medium and large opaque fixtures.
The comparison baseline is the accepted `current-b-15-fixed` result; tolerance is
`max(5%, 1 s)` per fixture.

| Fixture                    | Registered pages | Current wall | Accepted wall | Change | Result |
| -------------------------- | ---------------: | -----------: | ------------: | -----: | ------ |
| `real-mineru-e80477ff22ac` |               97 |      2.860 s |       2.828 s | +1.12% | passed |
| `real-mineru-a53faf7243d4` |              583 |     12.291 s |      12.384 s | -0.75% | passed |
| `real-mineru-81d6969edaf0` |             1278 |     16.522 s |      16.422 s | +0.61% | passed |

All three completed upload, analysis, draft preparation, candidate preview and publication. Publish
pointer promotion remained below 2 ms for every selected fixture. No A run, paired sequence or soak
was performed.

## Local Artifact Cleanup

After the durable evidence above was recorded, `.cache/`, `test-results/`, `dist/`, `.astro/` and the
generated `public/_astro/` tree (about 11 GiB total) were moved to the system trash. `.env`, both
private fixture roots and the three pre-existing untracked research documents remained present and
unchanged.
