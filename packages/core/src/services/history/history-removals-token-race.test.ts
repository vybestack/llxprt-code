/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  withRemovalFixture,
  assertRemovalRows,
} from './history-removals-test-helpers.js';
import {
  accountingFactory,
  accountingRow,
  accountingTexts,
  deferred,
} from './token-accounting-stream-test-helpers.js';

describe('pop rollback with pending token updates', () => {
  it('restores the settled token total when admission-time estimates finish during pop', async () => {
    await withRemovalFixture(async ({ history }) => {
      const entered = deferred();
      const release = deferred();
      let first = true;
      history.setTokenizerFactory(
        accountingFactory(async (text) => {
          if (first) {
            first = false;
            entered.resolve();
            await release.promise;
          }
          return text.length;
        }),
      );
      const input = [accountingRow(0), accountingRow(1)];
      history.addAll(input);
      await entered.promise;
      const listener = (event: {
        contentId: string | null | undefined;
      }): void => {
        if (event.contentId === null)
          throw new Error('token race observer failed');
      };
      history.on('tokensUpdated', listener);
      const popping = history.pop();
      try {
        release.resolve();
        await expect(popping).rejects.toThrow('token race observer failed');
        await history.waitForTokenUpdates();
        const expectedTokens = [0, 1]
          .flatMap((index) => accountingTexts(index))
          .reduce((sum, text) => sum + text.length, 0);
        expect(history.getTotalTokens()).toBe(expectedTokens);
        await assertRemovalRows(history.streamRawHistory(), input);
      } finally {
        release.resolve();
        history.off('tokensUpdated', listener);
      }
    });
  });
});
