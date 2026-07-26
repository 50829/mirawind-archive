# Quickstart: Validate the Publishing Loop

## Automated baseline

```bash
pnpm prepare:assets
pnpm format
pnpm lint
pnpm typecheck
pnpm test:contract
pnpm test:unit
pnpm test:integration
pnpm build
```

Expected: all commands pass; generated reader pages reference the versioned external reader
runtime and contain no inline script.

## Browser loop

Start the isolated local project and initialize the administrator when prompted:

```bash
./docker/local.sh up
```

Open `http://localhost:4321`, sign in, upload the registered 97-page fixture, wait for the
ready preview, change one structure node, save/rebuild and publish.

Verify:

- transfer reaches 100% before the server-acceptance state, not completion;
- the workbench opens only with a current ready preview;
- preview iframe sandbox is exactly `allow-scripts`;
- desktop/390px preview widths do not scale type;
- save conflict preserves local edits;
- publication is disabled for dirty/building/failed/blocking states;
- the published page matches the preview and remains readable with the KaTeX stylesheet
  blocked.

## Security checks

From browser tests, verify a preview asset returns hidden no-store 404 after logout, session
expiry, draft revision change and book deletion. Verify reader/renderer CSS, JS and fonts
return cross-origin-compatible one-year immutable headers while preview pages/resources
remain private/no-store.

## Scale and performance

Run the 20, 240-260, 501, 2,000 and 20,000-item workbench fixtures, then the 500-page
synthetic build and registered 97/441/583-page real fixtures. The 20,000-item case only
needs bounded DOM, non-crash and cancellable departure. Measure uncached public reading p95
on the reference host and require at most 300 ms.
