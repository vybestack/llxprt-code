/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

export function clearCompressionCallback(
  provider: IProvider | undefined,
  logger: DebugLogger,
): void {
  try {
    if (provider && typeof provider.setCompressionCallback === 'function') {
      provider.setCompressionCallback(null);
    }
  } catch (error) {
    logger.warn(
      () =>
        '[CompressionHandler] Failed to detach compression callback during cleanup',
      error,
    );
  }
}
