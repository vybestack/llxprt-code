/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import { inMemoryRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withoutFileCreation } from '../../../core/src/services/history/__tests__/support/without-file-creation.js';
import { acquireRequestRows } from './requestRowsLease.js';
import { providerRowsOf } from './providerRows.js';

import { normalizeLoadBalancerOptions } from '../loadBalancing/resolvedOptionsBuilder.js';
import { replayableContents } from './collectContents.js';
const rows: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'first' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'second' }] },
];

describe('provider request source admission', () => {
  it('admits the load-balancer empty default as caller-owned without scratch', async () => {
    await withoutFileCreation(async () => {
      const scope = acquireRequestRows(normalizeLoadBalancerOptions({}));
      try {
        const request = await providerRowsOf(scope.options);
        expect(request.count).toBe(0);
        expect(request.callerOwned).toBe(true);
        expect(() => request.readAt(0)).toThrow(RangeError);
      } finally {
        await scope.close();
      }
    });
  });
  it('rejects array iterators that omit the caller-owned source capability', async () => {
    await withoutFileCreation(async () => {
      const scope = acquireRequestRows({ contents: replayableContents(rows) });
      try {
        await expect(providerRowsOf(scope.options)).rejects.toThrow(
          'Provider contents require requestRows or an openProviderRequest source',
        );
      } finally {
        await scope.close();
      }
    });
  });
  it('rejects unindexed streams before consuming or staging them', async () => {
    await withoutFileCreation(async () => {
      const scope = acquireRequestRows({
        contents: {
          async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
            yield await Promise.reject<IContent>(
              new Error('Unindexed stream was consumed'),
            );
          },
        },
      });
      try {
        await expect(providerRowsOf(scope.options)).rejects.toThrow(
          'Provider contents require requestRows or an openProviderRequest source',
        );
      } finally {
        await scope.close();
      }
    });
  });

  it('reopens caller-owned rows with identical random access and no scratch', async () => {
    await withoutFileCreation(async () => {
      const scope = acquireRequestRows({
        contents: callerOwnedRawProviderSource(rows),
      });
      try {
        const request = await providerRowsOf(scope.options);
        expect(request.count).toBe(rows.length);
        expect(request.callerOwned).toBe(true);
        for (let pass = 0; pass < 2; pass++) {
          const actual: IContent[] = [];
          for await (const row of scope.options.contents) actual.push(row);
          expect(actual).toStrictEqual(rows);
        }
        for (let index = 0; index < rows.length; index++)
          expect(await request.readAt(index)).toStrictEqual(rows[index]);
        await scope.close();
        expect(() => request.readAt(0)).toThrow(
          'Provider request rows are closed',
        );
      } finally {
        await scope.close();
      }
      await expect(
        scope.options.contents[Symbol.asyncIterator]().next(),
      ).rejects.toThrow('Provider request rows are closed');
    });
  });

  it('reads an indexed selection without touching its unrelated contents', async () => {
    await withoutFileCreation(async () => {
      const scope = acquireRequestRows({
        requestRows: inMemoryRequestSelection(rows),
        contents: {
          async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
            yield await Promise.reject<IContent>(
              new Error('Unrelated contents was consumed'),
            );
          },
        },
      });
      try {
        const request = await providerRowsOf(scope.options);
        expect(request.count).toBe(rows.length);
        expect(await request.readAt(1)).toStrictEqual(rows[1]);
      } finally {
        await scope.close();
      }
    });
  });
});
