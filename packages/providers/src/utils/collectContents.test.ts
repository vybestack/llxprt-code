/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P05b3
 *
 * Behavioral tests for the shared stream-materialization helper providers
 * call at their generateChatCompletion entry points: the provider-facing
 * history contract is `AsyncIterable<IContent>` and the request-scoped
 * array is built from it (issue #854; P05b4 owns streamed request bodies).
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  collectContents,
  isAsyncIterableContents,
  replayableContents,
} from './collectContents.js';
import { acquireRequestRows } from './requestRowsLease.js';
import { providerRowsOf } from './providerRows.js';

function textContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

async function* toStream(rows: readonly IContent[]): AsyncIterable<IContent> {
  for (const row of rows) {
    yield row;
  }
}

describe('collectContents', () => {
  it('materializes an async iterable of IContent in order', async () => {
    const rows = [textContent('one'), textContent('two'), textContent('three')];
    const collected = await collectContents(toStream(rows));
    expect(collected).toStrictEqual(rows);
  });

  it('returns an empty array for an empty stream', async () => {
    const collected = await collectContents(toStream([]));
    expect(collected).toStrictEqual([]);
  });

  it('propagates upstream stream errors', async () => {
    async function* failing(): AsyncIterable<IContent> {
      yield textContent('first');
      throw new Error('upstream blew up');
    }
    await expect(collectContents(failing())).rejects.toThrow(
      'upstream blew up',
    );
  });
});

describe('isAsyncIterableContents', () => {
  it('accepts an async iterable of IContent', () => {
    expect(isAsyncIterableContents(toStream([textContent('x')]))).toBe(true);
  });

  it('rejects an options object and a plain array', () => {
    const options = { contents: [textContent('x')] };
    expect(isAsyncIterableContents(options)).toBe(false);
    expect(isAsyncIterableContents([textContent('x')])).toBe(false);
  });
});

describe('replayable caller-owned contents', () => {
  it('admits repeatable rows without copying or changing caller values', async () => {
    const input = [textContent('one'), textContent('two')];
    const source = replayableContents(input);
    const scope = acquireRequestRows({ contents: source });
    try {
      const rows = await providerRowsOf(scope.options);
      expect(rows.callerOwned).toBe(true);
      expect(rows.count).toBe(2);
      expect(rows.readAt(0)).toBe(input[0]);
      expect(rows.readAt(1)).toBe(input[1]);
      expect(await collectContents(source)).toStrictEqual(input);
      expect(await collectContents(source)).toStrictEqual(input);
    } finally {
      await scope.close();
    }
  });
});
