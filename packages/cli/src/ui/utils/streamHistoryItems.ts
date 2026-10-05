/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent, EmojiFilterMode } from '@vybestack/llxprt-code-core';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { HistoryItem } from '../types.js';
import type { RowSource } from './rowIdentity.js';
import { HistoryProjection } from './historyProjection.js';
import {
  createHistoryLedger,
  projectHistory,
} from '../stores/turn/historyLedger.js';

export interface StreamHistoryOptions {
  readonly signal?: AbortSignal;
  readonly temporaryRoot?: string;
  readonly sourceFor?: (row: IContent, index: number) => RowSource;
}

export async function* streamHistoryItems(
  rows:
    | AsyncIterable<IContent>
    | Iterable<IContent>
    | ((signal: AbortSignal | undefined) => AsyncIterable<IContent>),
  mode?: EmojiFilterMode,
  ownership?: RowOwnership,
  options: StreamHistoryOptions = {},
): AsyncIterable<HistoryItem> {
  const projection = new HistoryProjection(
    mode,
    ownership,
    options.temporaryRoot,
    options.signal,
  );
  try {
    let index = 0;
    options.signal?.throwIfAborted();
    const source = typeof rows === 'function' ? rows(options.signal) : rows;
    for await (const row of source)
      yield* projection.accept(row, options.sourceFor?.(row, index++));
    options.signal?.throwIfAborted();
    yield* projection.flush();
  } finally {
    projection.close();
  }
}

export async function resumeHistoryWindow(
  rows: AsyncIterable<IContent> | Iterable<IContent>,
  mode?: EmojiFilterMode,
  ownership?: RowOwnership,
): Promise<HistoryItem[]> {
  const ledger = createHistoryLedger(undefined, ownership);
  try {
    for await (const item of streamHistoryItems(rows, mode, ownership))
      ledger.append(item);
    const result = projectHistory(ledger.getState());
    for (const item of result) ownership?.retain(item);
    return result;
  } finally {
    ledger.clear();
  }
}
