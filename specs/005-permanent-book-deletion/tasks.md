# Tasks: Permanent Book Deletion

**Scope**: Delete one whole book permanently, regardless of whether it is draft, private,
published, failed, or contains both draft and published state.

- [x] T001 Record the irreversible/no-recycle-bin decision and synchronize the product spec
- [x] T002 Add schema 7 with an irreversible book barrier and content-free deletion tombstone
- [x] T003 Add exact-title, strong-state-token and idempotent deletion acceptance
- [x] T004 Release the alias, hide the book and enqueue cleanup in one transaction
- [x] T005 Cancel queued related work and request termination of running related work
- [x] T006 Exclude deleting books from public/private libraries, details, reading, search, resources and downloads
- [x] T007 Reject draft, publication, verification, retry and recovery finalization after the barrier
- [x] T008 Remove the deterministic book tree, retained uploads and related staging safely
- [x] T009 Purge draft, source, config, preview, original, version, presentation, search and import rows in FK-safe order
- [x] T010 Keep failed cleanup hidden and support explicit idempotent retry without restore
- [x] T011 Add the private library permanent-delete dialog and existing task-page handoff
- [x] T012 Update the API contract, migration packaging and operator/schema documentation
- [x] T013 Cover draft, published/full-graph, cancellation, retry, containment, migration and UI behavior with tests
- [x] T014 Pass formatting, lint, typecheck, production build and the complete 378-test suite

No recycle bin, restore, delayed retention or batch deletion is part of this feature.
