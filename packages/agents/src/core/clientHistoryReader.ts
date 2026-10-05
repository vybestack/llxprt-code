/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSession } from './chatSession.js';

export function createClientHistoryReader(
  readChat: () => ChatSession | undefined,
  readRetainedHistory: () => readonly IContent[] | undefined,
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
    const snapshot = captureRetainedHistory(readRetainedHistory, signal);
    if (snapshot !== undefined) {
      try {
        yield* snapshot.streamRows(signal);
      } finally {
        snapshot.close();
      }
      return;
    }
    const stored = readStoredHistory();
    if (stored !== undefined) yield* stored.streamRawHistory(signal);
  };
}

function captureRetainedHistory(
  readHistory: () => readonly IContent[] | undefined,
  signal?: AbortSignal,
): HistoryDensityRows | undefined {
  const history = readHistory();
  if (history === undefined) return undefined;
  const snapshot = new HistoryDensityRows();
  try {
    for (const row of history) {
      signal?.throwIfAborted();
      snapshot.append(row);
    }
    return snapshot;
  } catch (error) {
    snapshot.close();
    throw error;
  }
}
