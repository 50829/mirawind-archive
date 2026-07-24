export {};

const shutdownController = new AbortController();

function requestShutdown(signal: NodeJS.Signals): void {
  if (!shutdownController.signal.aborted) {
    shutdownController.abort(signal);
  }
}

process.once("SIGINT", requestShutdown);
process.once("SIGTERM", requestShutdown);

async function runWorker(): Promise<void> {
  process.stdout.write("Mirawind worker ready\n");

  await new Promise<void>((resolve) => {
    const lifecycleTimer = setInterval(() => {
      // The durable claim loop replaces this lifecycle tick in T035.
    }, 60_000);

    shutdownController.signal.addEventListener(
      "abort",
      () => {
        clearInterval(lifecycleTimer);
        resolve();
      },
      { once: true },
    );
  });
}

await runWorker();
