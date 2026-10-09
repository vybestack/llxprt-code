/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { requestScopedContents } from './requestScopedBody.js';

function source() {
  let pulls = 0;
  let closed = false;
  const rows: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      try {
        for (const text of ['alpha', 'beta', 'gamma']) {
          pulls += 1;
          yield { speaker: 'human', blocks: [{ type: 'text', text }] };
        }
      } finally {
        closed = true;
      }
    },
  };
  return { rows, state: () => ({ pulls, closed }) };
}

describe('request-owned progressive history', () => {
  it('replays a cancelled upload prefix then resumes its one-shot source', async () => {
    const history = source();
    const owner = requestScopedContents(history.rows);
    const first = owner.stream()[Symbol.asyncIterator]();
    expect(history.state()).toStrictEqual({ pulls: 0, closed: false });
    const head = await first.next();
    await first.return?.();
    expect(history.state()).toStrictEqual({ pulls: 1, closed: false });
    const replay: IContent[] = [];
    for await (const row of owner.stream()) replay.push(row);
    expect({ head: head.value, replay }).toMatchObject({
      head: { blocks: [{ text: 'alpha' }] },
      replay: [
        { blocks: [{ text: 'alpha' }] },
        { blocks: [{ text: 'beta' }] },
        { blocks: [{ text: 'gamma' }] },
      ],
    });
    expect(history.state()).toStrictEqual({ pulls: 3, closed: true });
    await owner.dispose();
  });

  it('closes the underlying producer and forbids reopening after disposal', async () => {
    const history = source();
    const owner = requestScopedContents(history.rows);
    const reader = owner.stream()[Symbol.asyncIterator]();
    await reader.next();
    await owner.dispose();
    await owner.dispose();
    expect(history.state()).toStrictEqual({ pulls: 1, closed: true });
    await expect(reader.next()).rejects.toThrow(
      'Request contents were disposed',
    );
    await expect(owner.materialize()).rejects.toThrow(
      'Request contents were disposed',
    );
  });
});

describe('request history failure and concurrent readers', () => {
  it('propagates producer failure without retrying an exhausted source', async () => {
    let closed = false;
    const owner = requestScopedContents({
      async *[Symbol.asyncIterator]() {
        try {
          yield {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'prefix' }],
          };
          throw new Error('history read failed');
        } finally {
          closed = true;
        }
      },
    });
    const attempts = await Promise.allSettled([
      owner.materialize(),
      owner.materialize(),
    ]);
    expect(attempts).toMatchObject([
      { status: 'rejected', reason: { message: 'history read failed' } },
      { status: 'rejected', reason: { message: 'history read failed' } },
    ]);
    expect(closed).toBe(true);
    await owner.dispose();
  });
  it('shares in-flight source reads between streaming and materialization', async () => {
    const history = source();
    const owner = requestScopedContents(history.rows);
    const reader = owner.stream()[Symbol.asyncIterator]();
    const [head, rows] = await Promise.all([
      reader.next(),
      owner.materialize(),
    ]);
    expect({ head: head.value, rows }).toMatchObject({
      head: { blocks: [{ text: 'alpha' }] },
      rows: [
        { blocks: [{ text: 'alpha' }] },
        { blocks: [{ text: 'beta' }] },
        { blocks: [{ text: 'gamma' }] },
      ],
    });
    expect(rows).toHaveLength(3);
    expect(history.state()).toStrictEqual({ pulls: 3, closed: true });
    await reader.return?.();
    await owner.dispose();
  });
});
