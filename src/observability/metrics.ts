import { statfs } from "node:fs/promises";

const maximumSamples = 2_048;

export interface Percentiles {
  readonly count: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}

export interface DiskUsage {
  readonly freeBytes: number;
  readonly totalBytes: number;
  readonly usedBytes: number;
}

function safeLabel(value: string, fallback: string): string {
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/u.test(value) ? value : fallback;
}

function percentile(
  values: readonly number[],
  quantile: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? null;
}

function percentiles(values: readonly number[]): Percentiles {
  return Object.freeze({
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  });
}

function append(samples: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) return;
  samples.push(value);
  if (samples.length > maximumSamples) {
    samples.splice(0, samples.length - maximumSamples);
  }
}

export class OperationalMetrics {
  private disk: DiskUsage | null = null;
  private readonly failures = new Map<string, number>();
  private readonly phases = new Map<string, number[]>();
  private readonly queueAges: number[] = [];
  private readonly reads: number[] = [];
  private readonly searches: number[] = [];
  private readonly transitions = new Map<string, number>();

  recordFailure(errorClass: string, errorCode: string): void {
    const label = `${safeLabel(errorClass, "unknown")}:${safeLabel(
      errorCode,
      "UNKNOWN_FAILURE",
    )}`;
    this.failures.set(label, (this.failures.get(label) ?? 0) + 1);
  }

  recordPhase(phase: string, durationMs: number): void {
    const label = safeLabel(phase, "unknown");
    const samples = this.phases.get(label) ?? [];
    append(samples, durationMs);
    this.phases.set(label, samples);
  }

  recordQueueAge(durationMs: number): void {
    append(this.queueAges, durationMs);
  }

  recordRequest(kind: "read" | "search", durationMs: number): void {
    append(kind === "read" ? this.reads : this.searches, durationMs);
  }

  recordTransition(transition: string): void {
    const label = safeLabel(transition, "unknown");
    this.transitions.set(label, (this.transitions.get(label) ?? 0) + 1);
  }

  async collectDiskUsage(path: string): Promise<DiskUsage> {
    const value = await statfs(path);
    const totalBytes = value.blocks * value.bsize;
    const freeBytes = value.bavail * value.bsize;
    this.disk = Object.freeze({
      freeBytes,
      totalBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
    });
    return this.disk;
  }

  snapshot() {
    return Object.freeze({
      disk: this.disk,
      failures: Object.freeze(
        Object.fromEntries([...this.failures.entries()].sort()),
      ),
      phases: Object.freeze(
        Object.fromEntries(
          [...this.phases.entries()]
            .sort(([left], [right]) => left.localeCompare(right, "en"))
            .map(([phase, values]) => [phase, percentiles(values)]),
        ),
      ),
      queueAgeMs: percentiles(this.queueAges),
      requestMs: Object.freeze({
        read: percentiles(this.reads),
        search: percentiles(this.searches),
      }),
      transitions: Object.freeze(
        Object.fromEntries([...this.transitions.entries()].sort()),
      ),
    });
  }
}

export const operationalMetrics = new OperationalMetrics();
