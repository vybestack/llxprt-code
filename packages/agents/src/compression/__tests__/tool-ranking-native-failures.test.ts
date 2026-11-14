/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { exactTokenizer } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  openNativeToolRanking,
  truncateNativeToolResponses,
} from '../native-tool-ranking.js';
import type { OnePassTruncatorDeps } from '../toolResponseOnePass.js';
import {
  withNativeFallbackFixture,
  type NativeFallbackFixture,
} from './support/native-fallback-fixture.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';

function deps(fixture: NativeFallbackFixture): OnePassTruncatorDeps {
  return {
    historyService: fixture.history,
    rankingRevision: 'rank-errors:1',
    logger: new DebugLogger('test:rank-errors'),
    pendingContents: [],
    estimateBlockTokensAsync: async (block) =>
      block.type === 'tool_response' &&
      block.providerMetadata?.contextTruncated !== true
        ? 1000
        : 100,
    computeProjected: async () => 1000,
    getRuntimeModel: () => 'rank-errors',
  };
}

describe('native ranking failure and key boundaries', () => {
  it('preserves the projection failure as primary and closes the native pin with ordered cleanup failures', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      await fixture.seed([toolRankingRow(0, 64)]);
      const original = new Error('projection failed');
      const cleanup = new Error('ranking pin close failed');
      const input = {
        ...deps(fixture),
        computeProjected: (): never => {
          throw original;
        },
      };
      const snapshot = await openNativeToolRanking(input);
      if (snapshot === undefined)
        throw new Error('Native fixture did not open ranking');
      const close = snapshot.close.bind(snapshot);
      const closing = spyOn(snapshot, 'close').mockImplementation(async () => {
        await close();
        throw cleanup;
      });
      try {
        const failure = await truncateNativeToolResponses(
          input,
          snapshot,
          500,
        ).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(AggregateError);
        if (!(failure instanceof AggregateError))
          throw new Error('Missing cleanup aggregation');
        expect(failure.errors).toStrictEqual([original, cleanup]);
        expect(failure.cause).toBe(original);
      } finally {
        closing.mockRestore();
      }
    });
  }, 180_000);
  it('preserves abort identity without publishing tentative stubs', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      await fixture.seed([toolRankingRow(0, 64)]);
      const before = await fixture.durable();
      const controller = new AbortController();
      const original = new Error('ranking aborted');
      const input = { ...deps(fixture), signal: controller.signal };
      const snapshot = await openNativeToolRanking(input);
      if (snapshot === undefined)
        throw new Error('Native fixture did not open ranking');
      controller.abort(original);
      await expect(
        truncateNativeToolResponses(input, snapshot, 500),
      ).rejects.toBe(original);
      expect(await fixture.durable()).toStrictEqual(before);
    });
  }, 180_000);
  it('keys ranking by model, provider and tokenizer replacement and propagates key-resolution failures', async () => {
    await withNativeFallbackFixture(async ({ history }) => {
      history.setTokenizerFactory(exactTokenizer());
      history.setActiveTokenizationTarget('model-a', 'provider-a');
      const initial = history.toolRankingRevision('model-a');
      expect(history.toolRankingRevision('model-a')).toBe(initial);
      expect(history.toolRankingRevision('model-b')).not.toBe(initial);
      history.setActiveTokenizationTarget('model-a', 'provider-b');
      const changedProvider = history.toolRankingRevision('model-a');
      expect(changedProvider).not.toBe(initial);
      history.setTokenizerFactory(exactTokenizer());
      expect(history.toolRankingRevision('model-a')).not.toBe(changedProvider);
      const failure = new Error('tokenizer options unavailable');
      history.setTokenizerFactory({
        getTokenizer: (): never => {
          throw failure;
        },
      });
      expect(() => history.toolRankingRevision('model-a')).toThrow(failure);
    });
  }, 180_000);
});
