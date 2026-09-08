# Generated hostile archive fixtures

Do not commit generated ZIPs. Build them deterministically under the ignored
`test-results/` directory:

```bash
pnpm fixtures:build-hostile --output test-results/generated-fixtures/hostile
pnpm fixtures:build-stress --output test-results/generated-fixtures/stress-mineru.zip
```

The hostile generator writes a `manifest.json` containing each filename, expected stable
failure category, byte size and SHA-256. Repeated runs with the same code produce identical
bytes. It covers:

- parent, backslash, POSIX-absolute and drive-absolute paths;
- duplicate and Unicode-normalization collisions;
- Unix symlink and FIFO metadata;
- encryption, unsupported compression and multi-disk flags;
- truncated central-directory, local/central name mismatch and declared-size lies;
- 21-level directory depth, over-255-byte component and over-2,048-byte path;
- actual expansion beyond the 64 MiB ratio threshold at greater than 200:1;
- 20,001 entries.

`valid-control.zip` is the only acceptance control. Every other archive must fail as a whole,
leave no readable staging output, and preserve the current publication.

The stress generator creates `content_list_v2.json` and deterministic SVG resources.
Defaults are 500 pages, 20 paragraphs per page and 32
images. Options are bounded to avoid accidental multi-gigabyte fixtures. A sidecar JSON
records parameters, size and SHA-256. This synthetic book exercises scale and repeatability
but cannot replace the administrator-supplied real MinerU ZIPs in final acceptance.
