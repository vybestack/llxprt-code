/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { getRequestSignal } from './abortSignal.js';
import { isAsyncIterableContents } from './collectContents.js';
import { stagedRequestRows } from './requestRowsLease.js';

export type ProviderRowsOptions = Pick<
  GenerateChatOptions,
  'requestRows' | 'invocation' | 'metadata'
> & {
  /**
   * A one-shot stream handed out by `acquireRequestRows`, or the collected
   * array of an already normalized call, which has no rows to offer unless it
   * carries `requestRows`.
   */
  readonly contents: AsyncIterable<IContent> | readonly IContent[];
};

/**
 * The call's rows as a repeatable, countable selection with random access, so
 * a transport never needs a history array. A call with `requestRows` uses that
 * selection. Any other call uses the disk copy that `acquireRequestRows` staged
 * for its one-shot `contents`; that copy is completed here, one row in memory
 * at a time. A stream that did not come from `acquireRequestRows` is an error.
 *
 * Every reader checks the rows it yields against `count` and fails with
 * "Provider request rows count changed" when a pass sees more or fewer.
 */
export async function providerRowsOf(
  options: ProviderRowsOptions,
): Promise<ProviderRequestRows> {
  const signal = getRequestSignal(options);
  signal?.throwIfAborted();
  const rows = options.requestRows ?? (await stagedRows(options.contents));
  return checkedRows(rows, signal);
}

function stagedRows(
  contents: ProviderRowsOptions['contents'],
): Promise<ProviderRequestRows> {
  if (!isAsyncIterableContents(contents)) {
    return Promise.reject(
      new Error('Provider request rows require a requestRows selection'),
    );
  }
  return stagedRequestRows(contents);
}

function checkedRows(
  rows: ProviderRequestRows,
  requestSignal: AbortSignal | undefined,
): ProviderRequestRows {
  const { count } = rows;
  return Object.freeze({
    count,
    async *openReader(
      signal?: AbortSignal,
    ): AsyncGenerator<IContent, void, unknown> {
      const active = signal ?? requestSignal;
      let seen = 0;
      for await (const row of rows.openReader(active)) {
        active?.throwIfAborted();
        if (seen === count) throw countChanged();
        seen++;
        yield row;
      }
      if (seen !== count) throw countChanged();
    },
    readAt: (index: number, signal?: AbortSignal) =>
      rows.readAt(index, signal ?? requestSignal),
  });
}

function countChanged(): Error {
  return new Error('Provider request rows count changed');
}
