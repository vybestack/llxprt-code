/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
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
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
): Promise<void> {
  const getBucketFailoverHandler = () =>
    runtime.bucketFailover.getBucketFailoverHandler();

  if (!isContinuation) {
    startNewPrompt();
    setThought(null);
    thinkingBlocksRef.current = [];
    const handler = getBucketFailoverHandler();
    handler?.reset?.();

    // Invalidate auth cache at turn boundaries for new turns
    // This ensures tokens updated by other processes are picked up
    if (handler?.invalidateAuthCache) {
      const runtimeId = runtime.session.getSessionId();
      handler.invalidateAuthCache(runtimeId);
    }
  } else {
    getBucketFailoverHandler()?.resetSession?.();
  }
  try {
    await getBucketFailoverHandler()?.ensureBucketsAuthenticated?.();
  } catch {
    // Swallow — partial auth is acceptable.
  }
}
