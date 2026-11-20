/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

export async function settleStreamUsage(
  history: HistoryService,
  logger: DebugLogger,
  promptTokens: number | null,
  fallbackTokens: number | null,
  afterPublication?: () => void | Promise<void>,
): Promise<void> {
  await history.waitForTokenUpdates();
  let tokens: number | null = null;
  if (promptTokens !== null && promptTokens > 0) tokens = promptTokens;
  else if (fallbackTokens !== null && fallbackTokens > 0)
    tokens = fallbackTokens;
  if (tokens !== null) {
    logger.debug(
      () =>
        `[StreamProcessor] Syncing prompt token count to HistoryService: ${tokens}`,
    );
    history.syncTotalTokens(tokens);
    await history.waitForTokenUpdates();
  } else {
    logger.debug(
      () =>
        `[StreamProcessor] No token count to sync (lastPromptTokenCount: ${fallbackTokens})`,
    );
  }
  await afterPublication?.();
}
