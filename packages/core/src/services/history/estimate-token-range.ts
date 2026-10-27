/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DebugLogger } from '../../debug/DebugLogger.js';
import type { TokenRowSource } from './history-token-tickets.js';
import {
  estimateContentTokens,
  type TokenizerProvider,
} from './historyTokenEstimation.js';

export async function estimateTokenRange(
  source: TokenRowSource,
  model: string,
  provider: TokenizerProvider,
  logger: DebugLogger,
  signal?: AbortSignal,
): Promise<{ readonly tokens: number; readonly rows: number }> {
  let tokens = 0;
  let rows = 0;
  try {
    while (source.hasNext?.() === true) {
      signal?.throwIfAborted();
      const content = await (source.readForTokens?.() ?? source.read());
      tokens +=
        'estimateTokens' in content
          ? await content.estimateTokens(model, provider, logger)
          : await estimateContentTokens(
              content,
              model,
              provider,
              logger,
              signal,
            );
      rows++;
      signal?.throwIfAborted();
    }
    return { tokens, rows };
  } finally {
    await source.close();
  }
}
