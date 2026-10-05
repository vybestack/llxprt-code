/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import { streamSemanticPurgeRequest } from './streamRequestHelpers.js';

async function fixture(): Promise<{
  history: HistoryService;
  ownership: RowOwnership;
  attempt: NonNullable<Awaited<ReturnType<SemanticMediaPurgeSession['begin']>>>;
}> {
  const history = new HistoryService();
  const ownership = new RowOwnership();
  for (const text of ['first', 'second'])
    history.add({
      speaker: 'human',
      blocks: [
        { type: 'text', text },
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'aW1hZ2U=',
        },
      ],
    });
  const session = new SemanticMediaPurgeSession({
    history,
    ownership,
    mode: () => 'remove',
    persist: async () => {},
  });
  const attempt = await session.begin(false);
  if (!attempt) {
    history.dispose();
    throw new Error('missing purge');
  }
  return { history, ownership, attempt };
}

describe('semantic request stream backpressure', () => {
  it('keeps construction cold, reads one row per demand, and releases a suspended reader on return', async () => {
    const { history, ownership, attempt } = await fixture();
    const before = ownership.snapshot();
    const source = streamSemanticPurgeRequest(attempt);
    if (!source) throw new Error('missing rows');
    const rows = source[Symbol.asyncIterator]();
    try {
      expect(ownership.snapshot().acquisitions - before.acquisitions).toBe(0);
      const first = await rows.next();
      expect(first.value?.blocks).toStrictEqual([
        { type: 'text', text: 'first' },
      ]);
      const suspended = ownership.snapshot();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(ownership.snapshot().acquisitions - suspended.acquisitions).toBe(
        0,
      );
      expect(suspended.liveRows - before.liveRows).toBe(1);
      if (!rows.return) throw new Error('missing return');
      await rows.return();
      expect(ownership.snapshot().liveRows).toBe(before.liveRows);
    } finally {
      await rows.return?.();
      attempt.finalize();
      history.dispose();
    }
  });
});

async function requestExit(
  source: AsyncIterable<IContent>,
  exit: string,
  controller: AbortController,
): Promise<{ yielded: number; failure: unknown }> {
  let yielded = 0;
  let failure: unknown;
  try {
    for await (const row of source) {
      void row;
      yielded++;
      if (exit === 'break') break;
      if (exit === 'consumer-fault') throw new Error('consumer failed');
      controller.abort(new Error('request aborted'));
    }
  } catch (error: unknown) {
    failure = error;
  }
  return { yielded, failure };
}

describe('semantic request stream reader exits', () => {
  it.each(['break', 'consumer-fault', 'abort'])(
    'releases row ownership on %s',
    async (exit) => {
      const { history, ownership, attempt } = await fixture();
      const before = ownership.snapshot().liveRows;
      const controller = new AbortController();
      const source = streamSemanticPurgeRequest(attempt, controller.signal);
      if (!source) throw new Error('missing rows');
      const expected: Record<string, string | undefined> = {
        break: undefined,
        abort: 'request aborted',
        'consumer-fault': 'consumer failed',
      };
      try {
        const { yielded, failure } = await requestExit(
          source,
          exit,
          controller,
        );
        expect(yielded).toBe(1);
        expect(failure instanceof Error ? failure.message : failure).toBe(
          expected[exit],
        );
        expect(ownership.snapshot().liveRows - before).toBe(0);
      } finally {
        attempt.finalize();
        history.dispose();
      }
    },
  );
});
