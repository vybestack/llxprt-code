import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withNativeDetachedFixture,
  type NativeDetachedFixture,
} from '@vybestack/llxprt-code-core/services/history/__tests__/support/detached-contract-fixture.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RefusalAttempt } from './refusalTypes.js';
import { openReviewWindow } from './reviewWindow.js';
import { applyReviewedRewrite } from './rewriteApplier.js';

const ATTEMPT: RefusalAttempt = {
  finishReason: 'refusal',
  turnId: 'turn-1',
  promptId: 'prompt-1',
  attemptIndex: 2,
  provider: 'anthropic',
  model: 'claude-opus-5-5',
};
const REVIEWER = { profile: 'sonnet', provider: 'anthropic', model: 'sonnet' };
const ORIGINAL = 'kills 3 mutants in src/a.ts';
const REWRITTEN = 'terminates 3 mutants in src/a.ts';

async function scenario(fixture: NativeDetachedFixture) {
  const history = fixture.history;
  await history.addBatch([
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: ORIGINAL }],
      metadata: { isSummary: true },
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'keep going' }] },
  ]);
  const window = await openReviewWindow(history, [], 50_000);
  return {
    history,
    window,
    rewrites: [{ id: window.entries[0].id, newText: REWRITTEN }],
  };
}
function request(s: Awaited<ReturnType<typeof scenario>>) {
  return {
    ...s,
    execution: undefined,
    attempt: ATTEMPT,
    reviewer: REVIEWER,
    explanation: 'plain wording',
    operationId: 'op-9',
    now: new Date('2026-11-12T10:00:00.000Z'),
  };
}
async function texts(history: HistoryService): Promise<string[]> {
  const result: string[] = [];
  for await (const row of history.streamRawHistory())
    for (const block of row.blocks)
      if (block.type === 'text') result.push(block.text);
  return result;
}
async function audit(fixture: NativeDetachedFixture): Promise<unknown[]> {
  const result: unknown[] = [];
  for await (const entry of fixture.session.store.metadata(
    'refusal_rewrite:',
    'meta',
  ))
    result.push(JSON.parse(new TextDecoder().decode(entry.value)));
  return result;
}

describe('applying a reviewed rewrite', () => {
  it('commits the history and journals the original, the new text and the parent attempt', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const s = await scenario(fixture);
      const result = await applyReviewedRewrite(request(s));
      expect({
        kind: result.kind,
        live: await texts(s.history),
        records: await audit(fixture),
      }).toStrictEqual({
        kind: 'applied',
        live: [REWRITTEN, 'keep going'],
        records: [
          {
            operationId: 'op-9',
            time: '2026-11-12T10:00:00.000Z',
            promptId: 'prompt-1',
            attemptIndex: 2,
            reviewer: REVIEWER,
            explanation: 'plain wording',
            changes: [
              {
                id: s.window.entries[0].id,
                role: 'human',
                kind: 'summary',
                originalText: ORIGINAL,
                newText: REWRITTEN,
              },
            ],
          },
        ],
      });
      if (!(fixture.recording instanceof JournalRecordingService))
        throw new Error('Expected native recording service');
      const mirror = await fixture.recording.session();
      expect(await mirror.store.getMeta('refusal_rewrite:op-9')).toStrictEqual(
        await fixture.session.store.getMeta('refusal_rewrite:op-9'),
      );
      await fixture.durable();
    });
  });
  it('rolls the live rewrite back when the journal cannot take the record', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const s = await scenario(fixture);
      fixture.io.rejectNextWrite(new Error('journal is unwritable'), 'records');
      const result = await applyReviewedRewrite(request(s));
      expect({
        kind: result.kind,
        detail: result.kind === 'commit-failed' ? result.detail : '',
        live: await texts(s.history),
        records: await audit(fixture),
      }).toStrictEqual({
        kind: 'commit-failed',
        detail: 'journal is unwritable',
        live: [ORIGINAL, 'keep going'],
        records: [],
      });
      await fixture.durable();
    });
  });
  it('discards the rewrite when the history changed after it was reviewed', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const s = await scenario(fixture);
      await s.history.addBatch([
        { speaker: 'human', blocks: [{ type: 'text', text: 'late arrival' }] },
      ]);
      const result = await applyReviewedRewrite(request(s));
      expect({
        kind: result.kind,
        live: await texts(s.history),
        records: await audit(fixture),
      }).toStrictEqual({
        kind: 'history-changed',
        live: [ORIGINAL, 'keep going', 'late arrival'],
        records: [],
      });
    });
  });
  it('rewrites a host without a recording execution facade', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const s = await scenario(fixture);
      const result = await applyReviewedRewrite(request(s));
      expect({ kind: result.kind, live: await texts(s.history) }).toStrictEqual(
        { kind: 'applied', live: [REWRITTEN, 'keep going'] },
      );
    });
  });
  it('stops at the abort and writes nothing when cancelled during native preparation', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const s = await scenario(fixture);
      const controller = new AbortController();
      s.history.setTokenizerFactory({
        getTokenizer: () => ({
          countTokens: async () => {
            controller.abort();
            return 1;
          },
        }),
      });
      const result = await applyReviewedRewrite({
        ...request(s),
        signal: controller.signal,
      }).then(
        (value) => value.kind,
        (error: unknown) =>
          error instanceof Error ? `rejected:${error.name}` : 'rejected',
      );
      expect({
        result,
        live: await texts(s.history),
        records: await audit(fixture),
      }).toStrictEqual({
        result: 'rejected:AbortError',
        live: [ORIGINAL, 'keep going'],
        records: [],
      });
      await fixture.durable();
    });
  });
  it('rewrites eagerly journaled pending results at their native ordinals exactly once', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const s = await scenario(fixture);
      const row: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'c',
            toolName: 'shell',
            result: 'kills 3 mutants',
          },
        ],
        metadata: { turnId: 'tool-turn' },
      };
      await s.history.addBatch([row]);
      const pending = await s.history.getLastContent();
      if (pending === undefined) throw new Error('Missing pending row');
      const window = await openReviewWindow(s.history, [pending], 50_000);
      const entry = window.entries.find((item) => item.kind === 'tool_result');
      if (entry === undefined) throw new Error('Missing review result');
      expect(
        window.entries.filter((item) => item.kind === 'tool_result'),
      ).toHaveLength(1);
      const result = await applyReviewedRewrite({
        ...request(s),
        window,
        rewrites: [{ id: entry.id, newText: 'terminates 3 mutants' }],
        historyUnchanged: true,
      });
      expect(result.kind).toBe('applied');
      expect((await s.history.getLastContent())?.blocks).toStrictEqual([
        {
          type: 'tool_response',
          callId: 'c',
          toolName: 'shell',
          result: 'terminates 3 mutants',
        },
      ]);
      expect(await audit(fixture)).toHaveLength(1);
      await fixture.durable();
    });
  });
  it('keeps a committed rewrite and its large audit when a later mutation fails', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      const s = await scenario(fixture);
      const explanation = 'review detail '.repeat(2000);
      expect(
        (await applyReviewedRewrite({ ...request(s), explanation })).kind,
      ).toBe('applied');
      const before = await fixture.session.store.getMeta(
        'refusal_rewrite:op-9',
      );
      expect(before?.length).toBeGreaterThan(16 * 1024);
      await expect(
        s.history.detachedValues.transform(async () => {
          throw new Error('later failure');
        }),
      ).rejects.toThrow('later failure');
      expect(await texts(s.history)).toStrictEqual([REWRITTEN, 'keep going']);
      expect(
        await fixture.session.store.getMeta('refusal_rewrite:op-9'),
      ).toStrictEqual(before);
      if (!(fixture.recording instanceof JournalRecordingService))
        throw new Error('Expected native recording service');
      const mirror = await fixture.recording.session();
      expect(await mirror.store.getMeta('refusal_rewrite:op-9')).toStrictEqual(
        before,
      );
      await fixture.durable();
    });
  });
});
