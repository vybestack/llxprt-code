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

/** Waits installed by tests, by the id of the session that owns them. */
const installedWaits = new Map<string, RefusalWait>();

/**
 * The wait a session's refusal recovery uses: an abortable timer, unless a
 * test installed another for that session. The session id is read at each
 * wait because a resume can change it.
 */
export function refusalWaitFor(sessionId: () => string): RefusalWait {
  return (ms, signal) => (installedWaits.get(sessionId()) ?? delay)(ms, signal);
}

/**
 * Test seam: replaces the wait of one session so an end-to-end test can
 * observe requested backoffs without sleeping. Another session, or a late
 * callback of a test that already ended, is never affected. Returns a
 * function that removes the replacement.
 */
export function installRefusalWaitForTesting(
  sessionId: string,
  wait: RefusalWait,
): () => void {
  installedWaits.set(sessionId, wait);
  return () => {
    if (installedWaits.get(sessionId) === wait) {
      installedWaits.delete(sessionId);
    }
  };
}
