/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RuntimeTokenizerFactory } from '../../runtime/contracts/RuntimeTokenizerFactory.js';
export function createBlockedTokenizerFactory(): {
  factory: RuntimeTokenizerFactory;
  blockNext: () => Promise<void>;
  release: () => void;
} {
  let blocking = false;
  let startedResolve: (() => void) | undefined;
  let releaseResolve: (() => void) | undefined;
  let releasePromise = Promise.resolve();
  return {
    factory: {
      getTokenizer: () => ({
        countTokens: async (content: unknown) => {
          if (blocking) {
            blocking = false;
            startedResolve?.();
            await releasePromise;
          }
          return typeof content === 'string' ? content.length : 1;
        },
      }),
      estimatePrompt: async () => ({
        count: 0,
        method: 'exact' as const,
        family: 'test',
        estimatorVersion: '0',
        assetRevision: '0',
        projectionRevision: 0,
      }),
    },
    blockNext: () => {
      blocking = true;
      releasePromise = new Promise<void>((resolve) => {
        releaseResolve = resolve;
      });
      return new Promise<void>((resolve) => {
        startedResolve = resolve;
      });
    },
    release: () => releaseResolve?.(),
  };
}
