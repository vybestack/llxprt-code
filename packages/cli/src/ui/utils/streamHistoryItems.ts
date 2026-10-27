/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  EmojiFilterMode,
  RowOwnership,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../types.js';
import type { RowSource } from './rowIdentity.js';
import { HistoryProjection } from './historyProjection.js';
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
