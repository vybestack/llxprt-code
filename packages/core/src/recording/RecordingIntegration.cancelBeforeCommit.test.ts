/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRewriteFixture,
  ORIGINAL,
  REWRITTEN,
  rewriteSummary,
  rewriteState,
} from './__tests__/refusal-rewrite-test-helpers.js';

describe('cancelling a native refusal rewrite', () => {
  it('leaves live, persisted and journaled history unchanged when cancelled during preparation', async () => {
    await withRewriteFixture(async (fixture, integration) => {
      const controller = new AbortController();
      fixture.history.setTokenizerFactory({
        getTokenizer: () => ({
          countTokens: async () => {
            controller.abort();
            return 1;
          },
        }),
      });
      const failure = await rewriteSummary(fixture, {
        signal: controller.signal,
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBe(controller.signal.reason);
      await integration.flushAtTurnBoundary();
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [ORIGINAL],
        persisted: [ORIGINAL],
        rewriteRecords: [],
      });
    });
  });
  it('restores the prior journal version when cancelled during publication', async () => {
    await withRewriteFixture(async (fixture, integration) => {
      const controller = new AbortController();
      const failure = await rewriteSummary(fixture, {
        signal: controller.signal,
        onAcknowledged: () => {
          controller.abort();
        },
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(failure).toBe(controller.signal.reason);
      await integration.flushAtTurnBoundary();
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [ORIGINAL],
        persisted: [ORIGINAL],
        rewriteRecords: [],
      });
    });
  });
  it('keeps the rewrite everywhere when cancellation arrives after the transaction committed', async () => {
    await withRewriteFixture(async (fixture, integration) => {
      const controller = new AbortController();
      await rewriteSummary(fixture, { signal: controller.signal });
      controller.abort();
      await integration.flushAtTurnBoundary();
      expect(await rewriteState(fixture)).toStrictEqual({
        live: [REWRITTEN],
        persisted: [REWRITTEN],
        rewriteRecords: ['refusal_rewrite'],
      });
    });
  });
});
