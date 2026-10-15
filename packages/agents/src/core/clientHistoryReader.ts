/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSession } from './chatSession.js';

export function createClientHistoryReader(
  readChat: () => ChatSession | undefined,
  readStoredHistory: () => HistoryService | undefined,
): (signal?: AbortSignal) => AsyncGenerator<IContent, void, unknown> {
  return async function* (signal): AsyncGenerator<IContent, void, unknown> {
    signal?.throwIfAborted();
    const chat = readChat();
    if (chat !== undefined) {
      await chat.waitForIdle();
      signal?.throwIfAborted();
      yield* chat.streamHistory(signal);
      return;
    }
    const stored = readStoredHistory();
    if (stored !== undefined) yield* stored.streamRawHistory(signal);
  };
}
