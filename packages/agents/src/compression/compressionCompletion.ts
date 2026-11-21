/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

export async function completeCompressionAttempt(
  outcome: 'applied' | 'noop' | 'failed',
  logger: DebugLogger,
  waitForTokenUpdates: () => Promise<void>,
  onApplied: () => Promise<void>,
): Promise<PerformCompressionResult> {
  if (outcome === 'noop') {
    logger.debug(
      'Compression was a structural no-op — no history mutation or recording',
    );
    return PerformCompressionResult.NOOP;
  }

  await waitForTokenUpdates();
  if (outcome === 'applied') {
    await onApplied();
    return PerformCompressionResult.COMPRESSED;
  }

  logger.warn(
    'Compression strategy reported failure without applying history updates',
  );
  return PerformCompressionResult.FAILED;
}
