# Data model: Local Docker Preview

This feature adds no application schema or migration. It coordinates existing persistent
state through three operational entities.

## Local configuration

- **Location**: repository root `.env`, already Git-ignored
- **Fields**: data directory, localhost origin, Passkey RP ID, allowed hosts and
  high-entropy authentication secret
- **Validation**: secret has at least 32 high-entropy bytes and is not the example
  placeholder; file mode is `0600`
- **Exclusions**: administrator password, cookie, Passkey material and book content

## Local Compose project

- **Identity**: fixed project name `mirawind-local`
- **Processes**: one Web and one worker; initialization and migration are one-off processes
- **Network**: project-private network; only Web publishes `127.0.0.1:4321`
- **Proxy**: production Caddy is disabled in the local profile

## Persistent local library

- **Storage**: project-scoped `mirawind-data` named volume mounted at
  `/var/lib/mirawind`
- **Authority**: existing SQLite and immutable book-storage rules
- **Lifetime**: retained by start, status, logs and stop; never deleted by the launcher

## State transitions

```text
unconfigured
  → configured
  → volume initialized
  → migrations current
  → administrator bootstrapped
  → Web + worker healthy
  → stopped
  → Web + worker healthy
```

Any failed transition exits non-zero and does not claim readiness. Rerunning rechecks
durable configuration, migrations and administrator state rather than trusting an external
marker.
