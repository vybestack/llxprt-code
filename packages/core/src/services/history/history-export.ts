/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

export type HistoryJsonSink = (
  chunk: string,
  signal?: AbortSignal,
) => void | Promise<void>;

export async function awaitHistoryTask<T>(
  task: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return task;
  let aborted = (): void => {};
  const cancellation = new Promise<never>((_resolve, reject) => {
    aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
  try {
    return await Promise.race([task, cancellation]);
  } finally {
    signal.removeEventListener('abort', aborted);
  }
}

function serializedArrayRow(row: IContent, index: number): string {
  const json = JSON.stringify({ [String(index)]: row }, null, 2);
  const separator = json.indexOf(': ');
  return separator === -1 ? '  null' : `  ${json.slice(separator + 2, -2)}`;
}

export async function* streamHistoryJson(
  rows: AsyncIterable<IContent>,
  signal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  signal?.throwIfAborted();
  let index = 0;
  yield '[';
  for await (const row of rows) {
    signal?.throwIfAborted();
    yield `${index === 0 ? '\n' : ',\n'}${serializedArrayRow(row, index)}`;
    index++;
  }
  signal?.throwIfAborted();
  yield index === 0 ? ']' : '\n]';
}

export async function writeHistoryJson(
  chunks: AsyncIterable<string>,
  write: HistoryJsonSink,
  signal?: AbortSignal,
): Promise<void> {
  for await (const chunk of chunks) {
    signal?.throwIfAborted();
    await awaitHistoryTask(Promise.resolve(write(chunk, signal)), signal);
    signal?.throwIfAborted();
  }
}
