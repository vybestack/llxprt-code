/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';

import { HistoryService } from './HistoryService.js';
import { createUserMessage } from './IContent.js';

/**
 * The twin of two old-store contracts that the journal store cannot give
 * (decision D-W7-5): the old store applies a clear inside the call, so a
 * clear overtakes an asynchronous mutation in flight and its effect is
 * visible when the call returns. A journal clear runs behind the mutation in
 * flight and is applied when its promise settles. What both stores promise:
 * a settled clear has emptied the history, and a clear called while a
 * replacement is in flight leaves the history empty once both settle.
 *
 * Twins of "clear() ... has already applied when it returns" in
 * HistoryService.promiseMutations.test.ts and of "applies clear after an
 * in-flight replacement" in HistoryService.replaceAll.test.ts.
 */
function gatedTokenizer(): {
  factory: RuntimeTokenizerFactory;
  blockNext: () => Promise<void>;
  release: () => void;
} {
  let blocking = false;
  let started: (() => void) | undefined;
  let open: (() => void) | undefined;
  let gate = Promise.resolve();
  return {
    factory: {
      estimatePrompt: () =>
        Promise.reject(new Error('Prompt estimates are not used here')),
      getTokenizer: () => ({
        countTokens: async (content: unknown) => {
          if (blocking) {
            blocking = false;
            started?.();
            await gate;
          }
          return typeof content === 'string' ? content.length : 1;
        },
      }),
    },
    blockNext: () => {
      blocking = true;
      gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      return new Promise<void>((resolve) => {
        started = resolve;
      });
    },
    release: () => open?.(),
  };
}

describe.each(['journal'] as const)(
  'a clear and the mutations around it (%s store)',
  () => {
    let history: HistoryService;
    beforeEach(() => {
      history = new HistoryService();
    });
    afterEach(async () => {
      await history.dispose();
    });

    it('has emptied the history when its promise settles', async () => {
      history.add(createUserMessage('one'));
      history.add(createUserMessage('two'));

      const cleared = history.clear();
      expect(cleared).toBeInstanceOf(Promise);
      await cleared;

      expect(history.length()).toBe(0);
    });

    it('leaves the history empty after a replacement in flight settles', async () => {
      const gate = gatedTokenizer();
      history.setTokenizerFactory(gate.factory);
      const estimating = gate.blockNext();

      const replacing = history.replaceAll([createUserMessage('replacement')]);
      await estimating;
      const cleared = history.clear();
      gate.release();
      await Promise.all([replacing, cleared]);

      expect(await Array.fromAsync(history.streamRawHistory())).toStrictEqual(
        [],
      );
    });
  },
);
