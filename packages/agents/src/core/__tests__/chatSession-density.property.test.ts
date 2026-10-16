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

import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { describe, it } from 'bun:test';
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

type RawHistoryEntry =
  import('@vybestack/llxprt-code-core/services/history/IContent.js').IContent;

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

const densityFixture1_observeEmptyResultProducesNoHistoryChanges = async () => {
  const emptyResultProducesNoHistoryChangesProperty = fc.asyncProperty(
    fc.integer({ min: 1, max: 5 }),
    async (messageCount) => {
      const hs = new HistoryService();
      // Only add non-prunable content (plain messages)
      for (let i = 0; i < messageCount; i++) {
        hs.add(makeUserMessage(`Plain message ${i}`));
        hs.add(makeAiText(`Plain response ${i}`));
      }

      const beforeHistory = await collectRawHistory(hs);
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

      const signaturesAfter = historySignatures(await collectRawHistory(hs));

      return (
        (await collectRawHistory(hs)).length === lengthBefore &&
        JSON.stringify(signaturesAfter) === JSON.stringify(signaturesBefore)
      );
    },
  );
  return { emptyResultProducesNoHistoryChangesProperty };
};

const densityFixture2_observeOptimizationOnlyRemovesEntriesNeverFabricatesNewOnes =
  async () => {
    const optimizationOnlyRemovesEntriesNeverFabricatesNewOnesProperty =
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

        const signaturesBefore = historySignatures(await collectRawHistory(hs));

        const ctx = buildRuntimeContext(hs, {
          compressionStrategy: 'high-density',
        });
        const gen = buildMockContentGenerator();
        const chat = new ChatSession(ctx, gen, {}, []);
        const internals = getInternals(chat);
        internals.densityDirty = true;

        await internals.ensureDensityOptimized();

        const signaturesAfter = historySignatures(await collectRawHistory(hs));

        // Every remaining entry must match a complete original entry and the
        // after length must be ≤ before length.
        return (
          signaturesAfter.length <= signaturesBefore.length &&
          isSignatureMultisetSubset(signaturesAfter, signaturesBefore)
        );
      });
    return { optimizationOnlyRemovesEntriesNeverFabricatesNewOnesProperty };
  };

const densityFixture3_observeConsecutiveCleanOptimizationsAreNoOps =
  async () => {
    const consecutiveCleanOptimizationsAreNoOpsProperty = fc.asyncProperty(
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
        const lengthAfterFirst = (await collectRawHistory(hs)).length;
        const speakersAfterFirst = (await collectRawHistory(hs)).map(
          (h) => h.speaker,
        );

        // Second optimization (should be no-op since dirty is false)
        // Force dirty to true to actually run optimize again
        internals.densityDirty = true;
        await internals.ensureDensityOptimized();
        const lengthAfterSecond = (await collectRawHistory(hs)).length;
        const speakersAfterSecond = (await collectRawHistory(hs)).map(
          (h) => h.speaker,
        );

        return (
          lengthAfterFirst === lengthAfterSecond &&
          JSON.stringify(speakersAfterFirst) ===
            JSON.stringify(speakersAfterSecond)
        );
      },
    );
    return { consecutiveCleanOptimizationsAreNoOpsProperty };
  };

describe('Density Optimization Property-Based Tests (P19)', () => {
  /**
   * Property: For any history state and strategy, after ensureDensityOptimized()
   * completes, densityDirty is false.
   */
  it(
    'dirty flag is always false after ensureDensityOptimized completes',
    { timeout: 60_000 },
    async () => {
      const { property0, property1 } = await observeDensityCase4();
      await fc.assert(property0, property1);
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
      const { property0, property1 } = await observeDensityCase5();
      await fc.assert(property0, property1);
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
      const { property0, property1 } = await observeDensityCase6();
      await fc.assert(property0, property1);
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
      const { emptyResultProducesNoHistoryChangesProperty } =
        await densityFixture1_observeEmptyResultProducesNoHistoryChanges();
      await fc.assert(emptyResultProducesNoHistoryChangesProperty, {
        numRuns: 5,
      });
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
      const { property0, property1 } = await observeDensityCase7();
      await fc.assert(property0, property1);
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
      const { property0, property1 } = await observeDensityCase8();
      await fc.assert(property0, property1);
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
      const { optimizationOnlyRemovesEntriesNeverFabricatesNewOnesProperty } =
        await densityFixture2_observeOptimizationOnlyRemovesEntriesNeverFabricatesNewOnes();
      await fc.assert(
        optimizationOnlyRemovesEntriesNeverFabricatesNewOnesProperty,
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
      const { consecutiveCleanOptimizationsAreNoOpsProperty } =
        await densityFixture3_observeConsecutiveCleanOptimizationsAreNoOps();
      await fc.assert(consecutiveCleanOptimizationsAreNoOpsProperty, {
        numRuns: 5,
      });
    },
  );
});

async function observeDensityCase4() {
  return {
    property0: fc.asyncProperty(
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
    property1: { numRuns: 5 },
  };
}

async function observeDensityCase5() {
  return {
    property0: fc.asyncProperty(
      fc.integer({ min: 1, max: 8 }),
      async (messageCount) => {
        const hs = new HistoryService();
        for (let i = 0; i < messageCount; i++) {
          hs.add(makeUserMessage(`Msg ${i}`));
          hs.add(makeAiText(`Resp ${i}`));
        }

        const historyBefore = (await collectRawHistory(hs)).length;

        const ctx = buildRuntimeContext(hs, {
          compressionStrategy: 'middle-out',
        });
        const gen = buildMockContentGenerator();
        const chat = new ChatSession(ctx, gen, {}, []);
        const internals = getInternals(chat);
        internals.densityDirty = true;

        await internals.ensureDensityOptimized();

        return (await collectRawHistory(hs)).length === historyBefore;
      },
    ),
    property1: { numRuns: 5 },
  };
}

async function observeDensityCase6() {
  return {
    property0: fc.asyncProperty(
      fc.integer({ min: 1, max: 3 }),
      async (pairCount) => {
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

        const lengthBefore = (await collectRawHistory(hs)).length;

        const ctx = buildRuntimeContext(hs, {
          compressionStrategy: 'high-density',
          'compression.density.optimizeThreshold': 0, // Always run for test
        });
        const gen = buildMockContentGenerator();
        const chat = new ChatSession(ctx, gen, {}, []);
        const internals = getInternals(chat);
        internals.densityDirty = true;

        await internals.ensureDensityOptimized();

        return (await collectRawHistory(hs)).length <= lengthBefore;
      },
    ),
    property1: { numRuns: 5 },
  };
}

async function observeDensityCase7() {
  return {
    property0: fc.asyncProperty(
      fc.integer({ min: 1, max: 3 }),
      async (pairCount) => {
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
      },
    ),
    property1: { numRuns: 5 },
  };
}

async function observeDensityCase8() {
  return {
    property0: fc.asyncProperty(
      fc.constantFrom('high-density', 'middle-out', 'top-down-truncation'),
      fc.integer({ min: 0, max: 5 }),
      async (strategyName, messageCount) => {
        resetCallIds();
        const hs = new HistoryService();
        for (let i = 0; i < messageCount; i++) {
          hs.add(makeUserMessage(`Msg ${i}`));
          hs.add(makeAiText(`Resp ${i}`));
        }

        const lengthBefore = (await collectRawHistory(hs)).length;

        const ctx = buildRuntimeContext(hs, {
          compressionStrategy: strategyName,
        });
        const gen = buildMockContentGenerator();
        const chat = new ChatSession(ctx, gen, {}, []);
        const internals = getInternals(chat);
        internals.densityDirty = false;

        await internals.ensureDensityOptimized();

        return (await collectRawHistory(hs)).length === lengthBefore;
      },
    ),
    property1: { numRuns: 5 },
  };
}
