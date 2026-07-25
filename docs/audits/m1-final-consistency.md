# M1 final consistency audit

- Audited: 2026-07-25
- Tested code commit: `baff029949a7fd7bd39025fae12d3f70ec800b86`
- Authority baseline: Constitution v1.0.0 and D-001 through D-097
- Feature: `specs/001-mineru-public-publishing`
- Result: **PASSED**

## Final acceptance boundary

D-097 is reflected consistently in the product specification, feature specification,
implementation plan, research, Quickstart, architecture, fixture guidance, tests and
evidence. The accepted performance set contains:

- opaque 583-page and 441-page MinerU 3.4.4 real fixtures for representative large-book
  compatibility and performance;
- one opaque 97-page MinerU 3.4.4 real fixture for additional real-output compatibility;
- one generated 500-page synthetic fixture for repeatable ordinary-CI stress and resource
  regression.

The synthetic fixture does not substitute for real-book evidence. All real ZIPs and their
local manifest remain inside the entirely Git-ignored fixture directory, and tracked
content contains no book title, author, raw original filename, full text or local absolute
storage path.

## Spec Kit analysis

The final read-only analysis compared the constitution, decision log, product specification,
feature specification, plan, contracts, tasks, implementation and evidence.

| Metric                                         |    Result |
| ---------------------------------------------- | --------: |
| Functional requirements                        |        41 |
| Non-functional requirements                    |         9 |
| Success criteria                               |        10 |
| Tasks                                          |       152 |
| Requirements with implementation/test evidence |   50 / 50 |
| Unresolved clarification markers               |         0 |
| Unmitigated CRITICAL findings                  |         0 |
| HIGH / MEDIUM / LOW findings                   | 0 / 0 / 0 |

The only open task during analysis was T150, which is the creation of this audit itself.

## Convergence

The final `speckit-converge` assessment found no missing implementation work and appended no
tasks. `tasks.md` remained byte-for-byte unchanged during convergence, with matching
before/after SHA-256
`5bcd09ea0f7fcfef55535213160245c120981d290f74ed532de06b57b8f036a5`.

## Real-fixture and performance evidence

The final verifier required exactly the three administrator-approved real entries and
validated each MinerU version, byte size, SHA-256 and local-only usage scope. The production
Web/worker benchmark then passed every workload:

| Fixture role                 | Build wall ms | Peak process-tree RSS bytes | Idle read p95 ms | Concurrent-build read p95 ms | Normal / short search p95 ms |
| ---------------------------- | ------------: | --------------------------: | ---------------: | ---------------------------: | ---------------------------: |
| 583-page real representative |    34,702.517 |               2,899,320,832 |           26.205 |                        8.105 |              41.800 / 43.351 |
| 441-page real representative |    17,154.777 |               1,103,712,256 |            9.687 |                        7.644 |              24.104 / 21.012 |
| 97-page real compatibility   |     3,566.575 |                 296,435,712 |            8.140 |                        7.939 |              14.103 / 13.619 |
| 500-page synthetic stress    |     9,929.978 |                 730,877,952 |            7.223 |                        8.461 |              32.492 / 32.409 |

Every uncached reading p95 is below 300 ms and every supported search p95 is below one
second. Concurrent builds kept the already published version responsive and did not move
compilation into a reader request.

## Final release gates

The frozen dependency install and all 51 commits through the tested code commit passed.
Formatting, lint, Astro/TypeScript checks, 57 unit tests, 190 integration tests, 33 contract
tests, three Chromium production-stack journeys, the production build and final real-fixture
hash verification all exited zero. Exact commands are recorded in
`docs/audits/m1-release-verification.md`.

No feature work, unresolved decision conflict, unmitigated critical finding or acceptance
exception remains for M1.
