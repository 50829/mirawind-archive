# M1 migration and recovery report

- Captured: 2026-07-24T20:20:48.365Z
- Result: **PASSED**
- Representative data: one Git-ignored MinerU 3.4.4 production-build data root, copied to a disposable directory before mutation
- Representative logical shape: 1 book, 2 immutable versions, 8 jobs, 632 FTS rows, 1 registered original

## Stepwise migrations

| Version | Name                | Checksum                                                         | Applied | Integrity | Foreign-key violations |
| ------: | ------------------- | ---------------------------------------------------------------- | ------- | --------- | ---------------------: |
|       1 | m1_core             | 22168380aa61446124de8d7166a29deb03426956b2d300b98916abd7bd99686d | 1       | ok        |                      0 |
|       2 | better_auth         | 3fd4d3264984c7e1156d6ccc10b302c04c0f8388b684e87f755d51843f8dcb2f | 2       | ok        |                      0 |
|       3 | passkey_last_used   | 97defe21c9d481ccdb25f54172b2240631d17e8d158da2da68bed52a5835594b | 3       | ok        |                      0 |
|       4 | job_idempotency     | be75d0b5ff9ff299a626b287b2ed629feab872536542fd7494d31f7e047ce852 | 4       | ok        |                      0 |
|       5 | version_reclamation | 3cd4efdb28a8538ac22182c78a7e8e722d3ca1c67ce1a7cf7ff2ffaa641c12c8 | 5       | ok        |                      0 |

## Backup and restore

- SQLite online backup SHA-256: `0e0cea422c65fcf6b00ba690d6740e8d9685d82c7cd31bcecc01bd893d51b628`
- Pre-backup and restored logical snapshots match: true
- Restored database integrity: ok
- Restored foreign-key violations: 0
- Full persistent-tree copy identity matches before testing: true
- Copied tree: 89 files, 50485906 bytes, aggregate SHA-256 `8db591bb1e4526d2441983da7859c3f56b0d3c8e5f7051343945802c37416909`

## Version recovery

- Deliberately corrupted current version detected: true
- Previously verified superseded version promoted: true
- Public book retained a non-null current pointer: true
- Recovery audit event recorded: true

The corruption and restore operations ran only inside a disposable copy. The source fixture, its ZIP, its private text and all original filenames were neither modified nor written to this report. Temporary test copies were removed after evidence capture.
