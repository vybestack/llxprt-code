/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  ProviderContentEnforcer,
  CompressionGuardInfo,
} from './providerContentEnforcement.js';

export function attachCompressionCallback(
  provider: IProvider | undefined,
  promptId: string,
  enforcer: ProviderContentEnforcer,
  pendingContents: IContent[] | undefined,
  logger: DebugLogger,
): void {
  if (!provider || typeof provider.setCompressionCallback !== 'function') {
    return;
  }

  const callback = async (
    _contents: IContent[],
    guard?: CompressionGuardInfo,
  ): Promise<IContent[]> => {
    if (pendingContents === undefined) {
      throw new Error(
        'Compression callback invoked but the pending-content boundary is ' +
          'unrecoverable: a BeforeModel hook replaced or restructured the ' +
          'conversation contents, and no usable llm_request_boundary ' +
          'metadata was available, so compression cannot safely recompose ' +
          'the pending region.',
      );
    }
    try {
      return await enforcer.compressAndRecompose(
        pendingContents,
        promptId,
        guard,
        provider,
      );
    } catch (error) {
      logger.warn(
        () => '[CompressionHandler] Compression callback failed',
        error,
      );
      throw error;
    }
  };

  provider.setCompressionCallback(callback);
}

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
