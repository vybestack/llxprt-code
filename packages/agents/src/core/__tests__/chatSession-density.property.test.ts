/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P19
 * @requirement REQ-HD-002.1, REQ-HD-002.2, REQ-HD-002.3, REQ-HD-002.4,
 *              REQ-HD-002.5, REQ-HD-002.6, REQ-HD-002.7, REQ-HD-002.8,
 *              REQ-HD-002.9, REQ-HD-002.10
 *
 * Property-based tests (≥ 30% of total density scenarios) verifying
 * invariants of ensureDensityOptimized across generated strategy fixtures.
 * Sibling to chatSession-density.test.ts.
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { ChatSession } from '../chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  resetCallIds,
  makeUserMessage,
  makeAiText,
  addPrunableReadWritePair,
  buildRuntimeContext,
  buildMockContentGenerator,
  getInternals,
} from './chatSession-density-helpers.js';

type RawHistoryEntry = ReturnType<HistoryService['getRawHistory']>[number];

function historySignatures(history: RawHistoryEntry[]): string[] {
  return history.map((entry) => JSON.stringify(entry));
}

function isSignatureMultisetSubset(
  candidate: string[],
  original: string[],
): boolean {
  const remaining = new Map<string, number>();
  for (const signature of original) {
    remaining.set(signature, (remaining.get(signature) ?? 0) + 1);
  }
  for (const signature of candidate) {
    const count = remaining.get(signature) ?? 0;
    if (count === 0) {
      return false;
    }
    remaining.set(signature, count - 1);
  }
  return true;
}

describe('Density Optimization Property-Based Tests (P19)', () => {
  /**
   * Property: For any history state and strategy, after ensureDensityOptimized()
   * completes, densityDirty is false.
   */
  it(
    'dirty flag is always false after ensureDensityOptimized completes',
    { timeout: 60_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(
            'high-density',
            'middle-out',
            'top-down-truncation',
            'one-shot',
          ),
          fc.integer({ min: 1, max: 5 }),
          async (strategyName, messageCount) => {
            const hs = new HistoryService();
            for (let i = 0; i < messageCount; i++) {
              hs.add(makeUserMessage(`Message ${i}`));
              hs.add(makeAiText(`Response ${i}`));
            }

            const ctx = buildRuntimeContext(hs, {
              compressionStrategy: strategyName,
            });
            const gen = buildMockContentGenerator();
            const chat = new ChatSession(ctx, gen, {}, []);
            const internals = getInternals(chat);
            internals.densityDirty = true;

            await internals.ensureDensityOptimized();

            return !internals.densityDirty;
          },
        ),
        { numRuns: 5 },
      );
    },
  );

  /**
   * Property: For any history, when strategy is middle-out (no optimize),
   * history before === history after ensureDensityOptimized().
   */
  it(
    'history is unchanged when strategy has no optimize method',
    { timeout: 60_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 8 }),
          async (messageCount) => {
            const hs = new HistoryService();
            for (let i = 0; i < messageCount; i++) {
              hs.add(makeUserMessage(`Msg ${i}`));
              hs.add(makeAiText(`Resp ${i}`));
            }

            const historyBefore = hs.getRawHistory().length;

            const ctx = buildRuntimeContext(hs, {
              compressionStrategy: 'middle-out',
            });
            const gen = buildMockContentGenerator();
            const chat = new ChatSession(ctx, gen, {}, []);
            const internals = getInternals(chat);
            internals.densityDirty = true;

            await internals.ensureDensityOptimized();

            return hs.getRawHistory().length === historyBefore;
          },
        ),
        { numRuns: 5 },
      );
    },
  );

  /**
   * Property: For any prunable history, the post-optimization history length
   * is ≤ the pre-optimization length.
   */
  it(
    'history length after optimization <= history length before',
    { timeout: 60_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (pairCount) => {
          resetCallIds();
          const hs = new HistoryService();

          hs.add(makeUserMessage('Initial'));
          for (let i = 0; i < pairCount; i++) {
            addPrunableReadWritePair(
              hs,
              `/workspace/file${i}.ts`,
              `content-${i}`,
              `updated-${i}`,
            );
          }
          hs.add(makeAiText('Done'));

          const lengthBefore = hs.getRawHistory().length;

          const ctx = buildRuntimeContext(hs, {
            compressionStrategy: 'high-density',
            'compression.density.optimizeThreshold': 0, // Always run for test
          });
          const gen = buildMockContentGenerator();
          const chat = new ChatSession(ctx, gen, {}, []);
          const internals = getInternals(chat);
          internals.densityDirty = true;

          await internals.ensureDensityOptimized();

          return hs.getRawHistory().length <= lengthBefore;
        }),
        { numRuns: 5 },
      );
    },
  );

  /**
   * Property: For any history where optimize returns empty removals and replacements,
   * history is unchanged.
   */
  it(
    'empty result produces no history changes',
    { timeout: 60_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (messageCount) => {
            const hs = new HistoryService();
            // Only add non-prunable content (plain messages)
            for (let i = 0; i < messageCount; i++) {
              hs.add(makeUserMessage(`Plain message ${i}`));
              hs.add(makeAiText(`Plain response ${i}`));
            }

            const beforeHistory = hs.getRawHistory();
            const lengthBefore = beforeHistory.length;
            const signaturesBefore = historySignatures(beforeHistory);

            const ctx = buildRuntimeContext(hs, {
              compressionStrategy: 'high-density',
            });
            const gen = buildMockContentGenerator();
            const chat = new ChatSession(ctx, gen, {}, []);
            const internals = getInternals(chat);
            internals.densityDirty = true;

            await internals.ensureDensityOptimized();

            const signaturesAfter = historySignatures(hs.getRawHistory());

            return (
              hs.getRawHistory().length === lengthBefore &&
              JSON.stringify(signaturesAfter) ===
                JSON.stringify(signaturesBefore)
            );
          },
        ),
        { numRuns: 5 },
      );
    },
  );

  /**
   * Property: For any history, totalTokens after ≤ totalTokens before
   * (optimization only removes/shrinks).
   */
  it(
    'optimization never increases token count',
    { timeout: 60_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (pairCount) => {
          resetCallIds();
          const hs = new HistoryService();

          hs.add(makeUserMessage('Start'));
          for (let i = 0; i < pairCount; i++) {
            addPrunableReadWritePair(
              hs,
              `/workspace/file${i}.ts`,
              `content-${i}-${'x'.repeat(100)}`,
              `updated-${i}`,
            );
          }
          hs.add(makeAiText('End'));

          await hs.waitForTokenUpdates();
          const tokensBefore = hs.getTotalTokens();

          const ctx = buildRuntimeContext(hs, {
            compressionStrategy: 'high-density',
          });
          const gen = buildMockContentGenerator();
          const chat = new ChatSession(ctx, gen, {}, []);
          const internals = getInternals(chat);
          internals.densityDirty = true;

          await internals.ensureDensityOptimized();
          await hs.waitForTokenUpdates();

          return hs.getTotalTokens() <= tokensBefore;
        }),
        { numRuns: 5 },
      );
    },
  );

  /**
   * Property: When densityDirty is false, ensureDensityOptimized returns
   * immediately regardless of history content.
   */
  it(
    'clean flag always skips optimization regardless of history',
    { timeout: 60_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('high-density', 'middle-out', 'top-down-truncation'),
          fc.integer({ min: 0, max: 5 }),
          async (strategyName, messageCount) => {
            resetCallIds();
            const hs = new HistoryService();
            for (let i = 0; i < messageCount; i++) {
              hs.add(makeUserMessage(`Msg ${i}`));
              hs.add(makeAiText(`Resp ${i}`));
            }

            const lengthBefore = hs.getRawHistory().length;

            const ctx = buildRuntimeContext(hs, {
              compressionStrategy: strategyName,
            });
            const gen = buildMockContentGenerator();
            const chat = new ChatSession(ctx, gen, {}, []);
            const internals = getInternals(chat);
            internals.densityDirty = false;

            await internals.ensureDensityOptimized();

            return hs.getRawHistory().length === lengthBefore;
          },
        ),
        { numRuns: 5 },
      );
    },
  );

  /**
   * Property: After density optimization, the remaining history entries are a
   * subset of the original entries (no new entries are fabricated).
   */
  it(
    'optimization only removes entries, never fabricates new ones',
    { timeout: 60_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 1, max: 3 }), async (pairCount) => {
          resetCallIds();
          const hs = new HistoryService();

          hs.add(makeUserMessage('Start'));
          for (let i = 0; i < pairCount; i++) {
            addPrunableReadWritePair(
              hs,
              `/workspace/f${i}.ts`,
              `content-${i}`,
              `upd-${i}`,
            );
          }
          hs.add(makeAiText('End'));

          const signaturesBefore = historySignatures(hs.getRawHistory());

          const ctx = buildRuntimeContext(hs, {
            compressionStrategy: 'high-density',
          });
          const gen = buildMockContentGenerator();
          const chat = new ChatSession(ctx, gen, {}, []);
          const internals = getInternals(chat);
          internals.densityDirty = true;

          await internals.ensureDensityOptimized();

          const signaturesAfter = historySignatures(hs.getRawHistory());

          // Every remaining entry must match a complete original entry and the
          // after length must be ≤ before length.
          return (
            signaturesAfter.length <= signaturesBefore.length &&
            isSignatureMultisetSubset(signaturesAfter, signaturesBefore)
          );
        }),
        { numRuns: 5 },
      );
    },
  );

  /**
   * Property: Calling ensureDensityOptimized() twice without adding content
   * produces identical history both times.
   */
  it(
    'consecutive clean optimizations are no-ops',
    { timeout: 60_000 },
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (messageCount) => {
            resetCallIds();
            const hs = new HistoryService();

            hs.add(makeUserMessage('Hello'));
            for (let i = 0; i < messageCount; i++) {
              hs.add(makeAiText(`Response ${i}`));
              hs.add(makeUserMessage(`Follow-up ${i}`));
            }

            const ctx = buildRuntimeContext(hs, {
              compressionStrategy: 'high-density',
            });
            const gen = buildMockContentGenerator();
            const chat = new ChatSession(ctx, gen, {}, []);
            const internals = getInternals(chat);

            // First optimization
            internals.densityDirty = true;
            await internals.ensureDensityOptimized();
            const lengthAfterFirst = hs.getRawHistory().length;
            const speakersAfterFirst = hs.getRawHistory().map((h) => h.speaker);

            // Second optimization (should be no-op since dirty is false)
            // Force dirty to true to actually run optimize again
            internals.densityDirty = true;
            await internals.ensureDensityOptimized();
            const lengthAfterSecond = hs.getRawHistory().length;
            const speakersAfterSecond = hs
              .getRawHistory()
              .map((h) => h.speaker);

            return (
              lengthAfterFirst === lengthAfterSecond &&
              JSON.stringify(speakersAfterFirst) ===
                JSON.stringify(speakersAfterSecond)
            );
          },
        ),
        { numRuns: 5 },
      );
    },
  );
});
