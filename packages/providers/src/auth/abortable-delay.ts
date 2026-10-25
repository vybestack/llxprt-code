/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Waits `ms` milliseconds. Rejects with the signal's own reason as soon as
 * the signal aborts, including when it is already aborted.
 */
export async function abortableDelay(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  signal?.throwIfAborted();
  try {
    await sleep(ms, undefined, { signal });
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}
