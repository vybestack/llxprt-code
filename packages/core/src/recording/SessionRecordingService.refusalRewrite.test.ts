/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from '../services/history/__tests__/support/detached-contract-fixture.js';
import { RefusalRewritePayloadSchema } from './refusalRewritePayload.js';
import {
  withRewriteFixture,
  ORIGINAL,
  REWRITTEN,
  rewriteSummary,
  rewriteState,
  auditRecords,
  rewritePayload,
  textsOf,
} from './__tests__/refusal-rewrite-test-helpers.js';

describe('native refusal rewrite audit', () => {
  it('replays the rewritten rows without the original text', async () => {
    await withRewriteFixture(async (fixture) => {
      await rewriteSummary(fixture);
      await fixture.history.addBatch([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'continue' }] },
        { speaker: 'human', blocks: [{ type: 'text', text: 'next question' }] },
      ]);
      expect(await textsOf(fixture.persistedRows())).toStrictEqual([
        REWRITTEN,
        'continue',
        'next question',
      ]);
      expect(
        JSON.stringify(await textsOf(fixture.persistedRows())),
      ).not.toContain(ORIGINAL);
    });
  });
  it('keeps the original text in the audit itself', async () => {
    await withRewriteFixture(async (fixture) => {
      await rewriteSummary(fixture);
      expect(await auditRecords(fixture)).toStrictEqual([rewritePayload()]);
    });
  });
  it('records a pending-only rewrite without manufacturing history rows', async () => {
    await withNativeDetachedFixture(async (fixture) => {
      await rewriteSummary(fixture);
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [],
        persisted: [],
        rewriteRecords: ['refusal_rewrite'],
      });
    });
  });
  it('writes a completed rewrite once', async () => {
    await withRewriteFixture(async (fixture) => {
      await rewriteSummary(fixture);
      await fixture.recording.flush();
      expect(await auditRecords(fixture)).toHaveLength(1);
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [REWRITTEN],
        persisted: [REWRITTEN],
        rewriteRecords: ['refusal_rewrite'],
      });
    });
  });
  it('writes nothing for a rewrite whose preparation is rolled back', async () => {
    await withRewriteFixture(async (fixture) => {
      await expect(
        rewriteSummary(fixture, {
          afterPublication: () => {
            throw new Error('rollback rewrite');
          },
        }),
      ).rejects.toThrow('rollback rewrite');
      await fixture.history.addBatch([
        { speaker: 'human', blocks: [{ type: 'text', text: 'after' }] },
      ]);
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [ORIGINAL, 'after'],
        persisted: [ORIGINAL, 'after'],
        rewriteRecords: [],
      });
    });
  });
  for (const rollback of [false, true]) {
    it(`keeps the prepared rewrite off disk while an independent fact drains (rollback=${rollback})`, async () => {
      await withRewriteFixture(async (fixture) => {
        let entered: () => void = () => {};
        let release: () => void = () => {};
        const waiting = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        fixture.history.setTokenizerFactory({
          getTokenizer: () => ({
            fallbackPolicy: 'deny',
            countTokens: async () => {
              entered();
              await gate;
              if (rollback) throw new Error('preparation failed');
              return 4;
            },
          }),
        });
        const writing = rewriteSummary(fixture).then(
          () => 'committed',
          (error: unknown) =>
            error instanceof Error ? error.message : 'failed',
        );
        await waiting;
        fixture.recording.recordSessionMetadata('written during preparation');
        await fixture.recording.flush();
        expect(await auditRecords(fixture)).toStrictEqual([]);
        release();
        expect(await writing).toBe(
          rollback ? 'preparation failed' : 'committed',
        );
        expect(await rewriteState(fixture)).toStrictEqual({
          live: [rollback ? ORIGINAL : REWRITTEN],
          persisted: [rollback ? ORIGINAL : REWRITTEN],
          rewriteRecords: rollback ? [] : ['refusal_rewrite'],
        });
      });
    });
  }
  it('rejects a malformed stored audit without changing the history', async () => {
    await withRewriteFixture(async (fixture) => {
      await fixture.history.detachedValues.transform(
        async (source, sink) => {
          let index = 0;
          for await (const row of source.streamRows())
            await sink.appendDerived(index++, row);
        },
        undefined,
        {
          audit: {
            key: 'refusal_rewrite:invalid',
            value: new TextEncoder().encode(
              JSON.stringify({
                operationId: 'invalid',
                changes: 'not changes',
              }),
            ),
          },
        },
      );
      const [stored] = await auditRecords(fixture);
      expect(RefusalRewritePayloadSchema.safeParse(stored).success).toBe(false);
      expect(await textsOf(fixture.history.streamRawHistory())).toStrictEqual([
        ORIGINAL,
      ]);
    });
  });
});
