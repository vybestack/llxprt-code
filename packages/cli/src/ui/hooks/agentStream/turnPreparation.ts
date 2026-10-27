/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StreamRuntime } from '../../cliUiRuntime.js';

/**
 * Resets or carries-over per-turn state depending on whether this is a new
 * prompt or a continuation. Also handles bucket failover reset/reauth.
 */
export async function prepareTurnForQuery(
  isContinuation: boolean,
  runtime: StreamRuntime,
  startNewPrompt: () => void,
  setThought: (t: null) => void,
): Promise<void> {
  if (!isContinuation) {
    startNewPrompt();
    setThought(null);
    runtime.bucketFailover.resetBuckets?.();
  } else {
    runtime.bucketFailover.resetBucketSession?.();
  }
  try {
    await runtime.bucketFailover.ensureBucketsAuthenticated?.();
  } catch {
    // Swallow — partial auth is acceptable.
  }
}
