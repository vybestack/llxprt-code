/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  assertRowIndex,
  type ProviderRequestSelection,
  type ProviderRequestSource,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

export function diskAdmittedSource(
  rows: Iterable<IContent>,
  observeRead?: (row: IContent) => void,
): {
  readonly directory: string;
  readonly contents: AsyncIterable<IContent> & ProviderRequestSource;
  close(): Promise<void>;
} {
  const directory = mkdtempSync(join(tmpdir(), 'admitted-disk-source-'));
  let selection: ProviderRequestSelection | undefined;
  let closed = false;
  let released = false;
  return {
    directory,
    contents: {
      async openProviderRequest(signal) {
        signal?.throwIfAborted();
        if (closed || released) throw new Error('Admitted source is closed');
        if (selection !== undefined) return selection;
        let count = 0;
        for (const row of rows) {
          signal?.throwIfAborted();
          writeFileSync(join(directory, `${count++}.row`), serialize(row));
        }
        const readAt = (at: number, readerSignal?: AbortSignal): IContent => {
          readerSignal?.throwIfAborted();
          if (closed || released) throw new Error('Admitted source is closed');
          assertRowIndex(at, count);
          const row: IContent = deserialize(
            readFileSync(join(directory, `${at}.row`)),
          );
          observeRead?.(row);
          return row;
        };
        selection = {
          callerOwned: true,
          count,
          readAt,
          async *openReader(readerSignal) {
            for (let at = 0; at < count; at++) yield readAt(at, readerSignal);
          },
          close(): void {
            released = true;
          },
        };
        return selection;
      },
      [Symbol.asyncIterator](): AsyncIterator<IContent> {
        throw new Error('Admitted source must use its request selection');
      },
    },
    async close(): Promise<void> {
      closed = true;
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
