# Worker Orchestration Contract

## Parent Sequence

```text
recover expired attempts
-> checkpoint/report health when due
-> atomically claim at most one job
-> capture frozen input
-> execute one isolated child with heartbeat and cancellation
-> return bounded attempt outcome
-> complete exactly one terminal transition
-> publish health observation
-> repeat
```

## Ownership

- Input capture may read current subject records but cannot run the task or write terminal state.
- Attempt execution owns heartbeat, cancellation propagation, timeout and child process lifetime. It
  cannot update terminal lifecycle records.
- Completion owns result validation, subject finalization, terminal task state and permitted retry.
- Recovery uses the same subject terminalization and retry owners as live completion.
- Bootstrap owns environment, connections, startup reconciliation and scheduled verification/reclaim
  creation, using declared application operations for business state.
- The child registry is exhaustive over the closed task-kind union.

## Preserved Limits

- one running task globally;
- ten-second heartbeat and sixty-second lost lease;
- thirty-minute task timeout;
- ten-second SIGTERM-to-SIGKILL grace for the complete process group;
- one automatic retry only for existing eligible infrastructure interruptions;
- at most four rendered pages in flight, delivered in page order;
- candidate registration, deletion and current-version recovery retain existing transaction boundaries;
- child closure is confirmed before terminal state and cleanup.
