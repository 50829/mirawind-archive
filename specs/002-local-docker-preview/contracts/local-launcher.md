# Local launcher contract

## Command

```text
./docker/local.sh [up|status|logs|stop]
```

Omitting the action is equivalent to `up`.

## Actions

| Action   | Contract                                                                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `up`     | Validate Docker, create private configuration when absent, build, initialize ownership, migrate, interactively bootstrap only when needed, wait for healthy Web and worker, then print the exact login URL |
| `status` | Show the local project's bounded container and health state                                                                                                                                                |
| `logs`   | Follow Web and worker logs without adding secret values                                                                                                                                                    |
| `stop`   | Stop worker, then Web, while retaining the named volume                                                                                                                                                    |

Unknown actions return exit code `2` and print usage.

## Security contract

- The host listener is exactly `127.0.0.1:4321`.
- The generated secret is never written to stdout/stderr.
- `.env` has mode `0600` and remains outside Git and the Docker build context.
- Administrator password input is accepted only by the existing interactive offline CLI.
- No action accepts a password argument or environment variable.

## Failure contract

Missing Docker, an unavailable daemon, invalid existing configuration, build/migration
failure, non-interactive first bootstrap, occupied port or unhealthy service returns
non-zero. The launcher prints readiness only after both long-running processes are healthy.

## Persistence contract

Normal start and stop reuse the `mirawind-local` project and its named volume. The launcher
has no reset or volume-delete action.
