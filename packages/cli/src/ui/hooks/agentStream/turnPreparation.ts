/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config, ThinkingBlock } from '@vybestack/llxprt-code-core';

function bindOptionalConfigMethod<T extends (...args: never[]) => unknown>(
  method: T | undefined,
  config: Config,
): T | undefined {
  return method?.bind(config) as T | undefined;
}

/**
 * Resets or carries-over per-turn state depending on whether this is a new
 * prompt or a continuation. Also handles bucket failover reset/reauth.
 */
export async function prepareTurnForQuery(
  isContinuation: boolean,
  config: Config,
  startNewPrompt: () => void,
  setThought: (t: null) => void,
  thinkingBlocksRef: React.MutableRefObject<ThinkingBlock[]>,
): Promise<void> {
  const getBucketFailoverHandler = bindOptionalConfigMethod(
    config.getBucketFailoverHandler,
    config,
  );

  if (!isContinuation) {
    startNewPrompt();
    setThought(null);
    thinkingBlocksRef.current = [];
    getBucketFailoverHandler?.()?.reset?.();

    // Invalidate auth cache at turn boundaries for new turns
    // This ensures tokens updated by other processes are picked up
    const handler = getBucketFailoverHandler?.();
    if (handler?.invalidateAuthCache) {
      const getRuntimeSessionId = bindOptionalConfigMethod(
        config.getSessionId,
        config,
      );
      const runtimeId = getRuntimeSessionId?.() ?? 'default';
      handler.invalidateAuthCache(runtimeId);
    }
  } else {
    getBucketFailoverHandler?.()?.resetSession?.();
  }
  try {
    await getBucketFailoverHandler?.()?.ensureBucketsAuthenticated?.();
  } catch {
    // Swallow — partial auth is acceptable.
  }
}
