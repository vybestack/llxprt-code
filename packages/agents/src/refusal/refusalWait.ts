/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';

/**
 * Waits `ms` milliseconds before a refusal retry. It must reject with an
 * abort error as soon as `signal` aborts, so a cancelled request never sits
 * out the rest of a backoff.
 */
export type RefusalWait = (ms: number, signal?: AbortSignal) => Promise<void>;

let installedWait: RefusalWait = delay;

/** The production wait: an abortable timer, unless a test installed another. */
export const waitBeforeRefusalRetry: RefusalWait = (ms, signal) =>
  installedWait(ms, signal);

/**
 * Test seam: replaces the wait for the whole process so end-to-end tests can
 * observe requested backoffs without sleeping. Returns a function that
 * restores the previous wait.
 */
export function installRefusalWaitForTesting(wait: RefusalWait): () => void {
  const previous = installedWait;
  installedWait = wait;
  return () => {
    installedWait = previous;
  };
}
