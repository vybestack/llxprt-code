/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Schedules proactive token refresh timers so tokens are refreshed
 * before they expire: fires at (expiry - leadSec - jitterSec).
 *
 * @plan PLAN-20250214-CREDPROXY.P21
 * @requirement R16.1-R16.7
 * @pseudocode analysis/pseudocode/007-proactive-scheduler.md
 */
export interface ProactiveSchedulerOptions {
  refreshFn: (provider: string, bucket: string) => Promise<void>;
  leadTimeSec?: number; // default 300 (5 min before expiry)
  maxJitterSec?: number; // default 60
}

export class ProactiveScheduler {
  private readonly refreshFn: (
    provider: string,
    bucket: string,
  ) => Promise<void>;
  private readonly leadTimeSec: number;
  private readonly maxJitterSec: number;
  private readonly timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(options: ProactiveSchedulerOptions) {
    this.refreshFn = options.refreshFn;
    this.leadTimeSec = options.leadTimeSec ?? 300;
    this.maxJitterSec = options.maxJitterSec ?? 60;
  }

  schedule(provider: string, bucket: string, expiryEpochSec: number): void {
    const key = `${provider}:${bucket}`;

    // Cancel any existing timer for this key
    this.cancel(provider, bucket);

    const now = Date.now() / 1000;
    const jitter = Math.random() * this.maxJitterSec;
    const fireAt = expiryEpochSec - this.leadTimeSec - jitter;
    const delayMs = (fireAt - now) * 1000;

    if (delayMs <= 0) {
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.refreshFn(provider, bucket).catch((err) => {
        // Log error to prevent unhandled rejection; refresh will be retried on next schedule
        console.error(
          `Proactive refresh failed for ${provider}:${bucket}:`,
          err,
        );
      });
    }, delayMs);

    timer.unref();
    this.timers.set(key, timer);
  }

  cancel(provider: string, bucket: string): void {
    const key = `${provider}:${bucket}`;
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  get activeCount(): number {
    return this.timers.size;
  }
}
