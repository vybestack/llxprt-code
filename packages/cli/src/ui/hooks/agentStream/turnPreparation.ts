/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ThinkingBlock } from '@vybestack/llxprt-code-core';

/**
 * Resets or carries-over per-turn state depending on whether this is a new
 * prompt or a continuation. Also handles bucket failover reset/reauth.
 */
export async function prepareTurnForQuery(
  isContinuation: boolean,
  resetBuckets: () => void,
  startNewPrompt: () => void,
  setThought: (t: null) => void,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
  resetBucketSession: () => void,
  ensureBucketsAuthenticated: () => Promise<void>,
): Promise<void> {
  if (!isContinuation) {
    startNewPrompt();
    setThought(null);
    thinkingBlocksRef.current = [];
    resetBuckets();
  } else {
    resetBucketSession();
  }
  try {
    await ensureBucketsAuthenticated();
  } catch {
    // Swallow — partial auth is acceptable.
  }
}
