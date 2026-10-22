/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface PeriodicSampler {
  stop(): void;
}

/**
 * Runs `sample` repeatedly, waiting `intervalMs` after each run finishes.
 *
 * A heap histogram is synchronous and walks the whole heap, so one sample can
 * take far longer than a short interval. `setInterval` re-fires such a task
 * before the event loop reaches its poll and check phases, which leaves the
 * profiled application one loop turn per sample. Re-arming after the sample
 * completes guarantees the application a full interval of loop turns between
 * samples while keeping samples serial and unscheduled while stopped.
 */
export function startPeriodicSampler(
  intervalMs: number,
  sample: () => void,
): PeriodicSampler {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    timer = setTimeout(() => {
      sample();
      arm();
    }, intervalMs);
    timer.unref();
  };
  arm();
  return {
    stop: () => {
      clearTimeout(timer);
    },
  };
}
