/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '../debug/index.js';

const LOCAL_QUEUE_WAIT_WARNING_MS = 30_000;
const logger = new DebugLogger('llxprt:storage:media');

export function startMediaQueueWaitWarning(
  root: string,
  operation: string,
): () => void {
  const queuedAt = Date.now();
  const timer = setTimeout(() => {
    logger.warn(
      `Local media store queue wait exceeded ${LOCAL_QUEUE_WAIT_WARNING_MS}ms; still waiting`,
      { root, operation, waitedMs: Date.now() - queuedAt },
    );
  }, LOCAL_QUEUE_WAIT_WARNING_MS);
  timer.unref();
  return (): void => clearTimeout(timer);
}
