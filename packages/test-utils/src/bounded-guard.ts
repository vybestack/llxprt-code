/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Default budget a guarded promise is given before it is treated as hung. */
export const DEFAULT_BOUNDED_GUARD_MS = 5000;

/**
 * Races `promise` against a deadline so a test asserting that work is bounded
 * fails loudly instead of hanging when the bound regresses.
 *
 * The guard timer is cleared once the race settles, so a promise that resolves
 * first does not leave a pending callback holding the event loop open or
 * rejecting after the test has already finished.
 */
export function withBoundedGuard<T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_BOUNDED_GUARD_MS,
): Promise<T> {
  let guardTimer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<T>((_resolve, reject) => {
    guardTimer = setTimeout(
      () =>
        reject(
          new Error(`run was not bounded — hung past ${timeoutMs}ms guard`),
        ),
      timeoutMs,
    );
  });
  return Promise.race([promise, guard]).finally(() => {
    if (guardTimer !== undefined) {
      clearTimeout(guardTimer);
    }
  });
}
