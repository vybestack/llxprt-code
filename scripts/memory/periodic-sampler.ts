/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PeriodicSampler {
  stop(): void;
}

/**
 * Minimum application time granted per unit of sampling time. Sampling is
 * therefore limited to 1 / (1 + APP_TIME_PER_SAMPLE_TIME) of wall time
 * (20%), however small the requested interval is.
 */
export const APP_TIME_PER_SAMPLE_TIME = 4;

/**
 * Runs `sample` repeatedly, waiting after each run finishes for the larger of
 * `intervalMs` and `APP_TIME_PER_SAMPLE_TIME` times that run's own duration.
 *
 * A heap histogram is synchronous and walks the whole heap, so one sample can
 * take far longer than a short interval, and its cost grows with the heap.
 * `setInterval` re-fires such a task before the event loop reaches its poll
 * and check phases, which leaves the profiled application one loop turn per
 * sample. Re-arming after the sample completes keeps samples serial and
 * unscheduled while stopped, and the cost-proportional wait bounds the share
 * of the process the profiler may use, so a tiny interval cannot stretch the
 * profiled application's own work (on slow machines past its deadlines).
 */
export function startPeriodicSampler(
  intervalMs: number,
  sample: () => void,
): PeriodicSampler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (delayMs: number): void => {
    timer = setTimeout(() => {
      const startedAt = performance.now();
      sample();
      const costMs = performance.now() - startedAt;
      arm(Math.max(intervalMs, costMs * APP_TIME_PER_SAMPLE_TIME));
    }, delayMs);
    timer.unref();
  };
  arm(intervalMs);
  return {
    stop: () => {
      clearTimeout(timer);
    },
  };
}
