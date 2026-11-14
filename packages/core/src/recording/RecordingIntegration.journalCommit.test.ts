/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRewriteFixture,
  ORIGINAL,
  REWRITTEN,
  rewriteSummary,
  rewriteState,
} from './__tests__/refusal-rewrite-test-helpers.js';

describe('native journal refusal rewrite transactions', () => {
  for (const stage of ['records', 'trailer']) {
    it(`leaves live, persisted and journaled history on the original when ${stage} cannot be written`, async () => {
      await withRewriteFixture(async (fixture, integration) => {
        fixture.io.rejectNextWrite(
          new Error('journal append failed'),
          stage === 'records' ? 'records' : 'trailer',
        );
        await expect(rewriteSummary(fixture)).rejects.toThrow(
          'journal append failed',
        );
        await integration.flushAtTurnBoundary();
        expect(await rewriteState(fixture)).toStrictEqual({
          live: [ORIGINAL],
          persisted: [ORIGINAL],
          rewriteRecords: [],
        });
      });
    });
  }
  it('keeps the rewrite out of both journals when a queued write drains after a failed publication', async () => {
    await withRewriteFixture(async (fixture, integration) => {
      let release: () => void = () => {};
      let arrived: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        arrived = resolve;
      });
      const rewriting = rewriteSummary(fixture, {
        afterPublication: async () => {
          arrived();
          await gate;
          throw new Error('publication failed');
        },
      }).catch((error: unknown) => error);
      await entered;
      const following = fixture.history.addBatch([
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'written while rewrite commits' }],
        },
      ]);
      release();
      expect(await rewriting).toBeInstanceOf(Error);
      await following;
      await integration.flushAtTurnBoundary();
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [ORIGINAL, 'written while rewrite commits'],
        persisted: [ORIGINAL, 'written while rewrite commits'],
        rewriteRecords: [],
      });
    });
  });
  it('restores both journals even when a publication observer fails after acknowledgement', async () => {
    await withRewriteFixture(async (fixture, integration) => {
      await expect(
        rewriteSummary(fixture, {
          onAcknowledged: () => {
            throw new Error('observer failed');
          },
        }),
      ).rejects.toThrow('observer failed');
      await integration.flushAtTurnBoundary();
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [ORIGINAL],
        persisted: [ORIGINAL],
        rewriteRecords: [],
      });
    });
  });
  it('applies the rewrite everywhere when the transaction succeeds', async () => {
    await withRewriteFixture(async (fixture, integration) => {
      await rewriteSummary(fixture);
      await integration.flushAtTurnBoundary();
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [REWRITTEN],
        persisted: [REWRITTEN],
        rewriteRecords: ['refusal_rewrite'],
      });
    });
  });
  it('keeps a committed rewrite when a later operation fails', async () => {
    await withRewriteFixture(async (fixture, integration) => {
      await rewriteSummary(fixture);
      await expect(
        fixture.history.detachedValues.transform(async () => {
          throw new Error('cleanup after commit failed');
        }),
      ).rejects.toThrow('cleanup after commit failed');
      await integration.flushAtTurnBoundary();
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [REWRITTEN],
        persisted: [REWRITTEN],
        rewriteRecords: ['refusal_rewrite'],
      });
    });
  });
});
