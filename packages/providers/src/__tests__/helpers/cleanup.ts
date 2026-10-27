/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cleanup sequencing for providers test fixtures. Runs every step even when an
 * earlier one throws, then reports the collected failures.
 */
export async function runCleanupSteps(
  steps: ReadonlyArray<() => unknown | Promise<unknown>>,
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, 'Fixture cleanup failed');
  }
}

/**
 * Cleans up after a failed acquisition and rethrows the original failure,
 * folding any cleanup failure in as an AggregateError.
 */
export async function cleanupAfterFailure(
  primary: unknown,
  cleanup: () => void | Promise<void>,
): Promise<never> {
  try {
    await cleanup();
  } catch (secondary) {
    throw new AggregateError(
      [
        primary,
        ...(secondary instanceof AggregateError
          ? secondary.errors
          : [secondary]),
      ],
      'Fixture cleanup after failure failed',
    );
  }
  throw primary;
}
