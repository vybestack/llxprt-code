/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the provider-source hard-limit enforcement retry
 * policy (Issue #2588).
 *
 * The provider-source path must use the SAME margin policy and
 * one-retry-before-truncation retry policy as the pending enforcement path
 * (Issue #2067). Previously the provider path had its own divergent margin
 * calculation (missing the 0.5% cushion) and skipped the retry attempt,
 * causing needless compression at the near-limit boundary and premature
 * truncation.
 *
 * These tests follow dev-docs/RULES.md: their primary assertions cover
 * observable behavior (returned provider rows, error messages, pending
 * preservation). Call-state assertions additionally pin whether retry and
 * fallback boundaries were reached. The CompressionHandler source ladder and
 * HistoryService are real; only infrastructure boundaries (token estimation,
 * compression execution, the disk fallback truncation itself) are replaced.
 */

import * as disk from './provider-fallback-candidate-fixture.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  RuntimeCompressionCallback,
  RuntimeProvider,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import {
  makeUserMessage,
  buildRuntimeContext,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { enforceProviderSourceForTest } from './support/enforce-provider-source.js';
import { buildHandlerHarness } from './support/handler-harness.js';

const ISSUE_CONTEXT_LIMIT = 262_144;
const STANDARD_CONTEXT_LIMIT = 200_000;
const COMPRESSION_THRESHOLD = 0.8;

type DiskFallback = (
  promptId: string,
  install: Parameters<typeof disk.installFixtureCandidate>[0],
  targetTokenCount?: number,
) => Promise<boolean>;

let historyService: HistoryService;

function resetHistory(): void {
  vi.clearAllMocks();
  historyService = new HistoryService();
}

function restoreMocks(): void {
  vi.restoreAllMocks();
}

function textOf(rows: IContent[]): string {
  return rows
    .flatMap((c) => c.blocks)
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join(' ');
}

interface Scenario {
  pending: IContent;
  performCompression: ReturnType<
    typeof buildHandlerHarness
  >['performCompression'];
  /** Replaces the handler's disk truncation with `fallback`; wrapping stays real. */
  fallback: ReturnType<typeof vi.fn<DiskFallback>>;
  enforce: (
    estimateRows?: (rows: IContent[]) => Promise<number>,
    pendingRecoverable?: boolean,
  ) => Promise<IContent[]>;
  /** The provider compression callback captured by the last enforce call. */
  capturedCallback: () => RuntimeCompressionCallback;
}

function scenario(
  contextLimit: number,
  options: {
    generationConfig?: Record<string, unknown>;
    seedPending?: boolean;
  } = {},
): Scenario {
  const runtimeContext = buildRuntimeContext(historyService, {
    contextLimit,
    compressionThreshold: COMPRESSION_THRESHOLD,
  });
  historyService.add(makeUserMessage('established history'));
  const pending = makeUserMessage('pending request');
  const harness = buildHandlerHarness(historyService, runtimeContext, {
    realDiskFallback: true,
    generationConfig: options.generationConfig,
  });
  const fallback = vi.fn<DiskFallback>().mockResolvedValue(false);
  (
    harness.handler as unknown as { runDiskFallback: DiskFallback }
  ).runDiskFallback = fallback;
  let callback: RuntimeCompressionCallback | undefined;
  const provider = {
    name: 'test-provider',
    setCompressionCallback: (next: RuntimeCompressionCallback | null) => {
      callback = next ?? undefined;
    },
  } as unknown as RuntimeProvider;
  return {
    pending,
    performCompression: harness.performCompression,
    fallback,
    enforce: (estimateRows, pendingRecoverable) =>
      enforceProviderSourceForTest(
        harness.handler,
        historyService,
        [pending],
        'test-prompt',
        provider,
        estimateRows,
        pendingRecoverable,
      ),
    capturedCallback: () => {
      if (callback === undefined)
        throw new Error('provider compression callback was not attached');
      return callback;
    },
  };
}

async function thrownBy(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the call to throw');
}

function truncationFits(
  estimateSpy: { mockResolvedValue: (value: number) => unknown },
  text: string,
): DiskFallback {
  return async (_promptId, applyResult) => {
    estimateSpy.mockResolvedValue(50_000); // fits
    await disk.installFixtureCandidate(applyResult, [makeUserMessage(text)]);
    return true;
  };
}

describe('provider-source hard-limit retry policy (Issue #2588)', () => {
  beforeEach(resetHistory);
  afterEach(restoreMocks);

  describe('near-limit 0.5% capped cushion', () => {
    it('returns rows without overflow error for the exact issue-2588 near-limit shape', async () => {
      // Exact scenario from the issue:
      //   context limit   = 262144, completionBudget = 65536
      //   projected        = 261346
      //   old safety-adjusted limit (no cushion) = 262144 - 1000 = 261144
      //   tokensStillNeeded with old code = 261346 - 261144 = 202
      //
      // With the shared 0.5% cushion policy (same as pending #2067):
      //   cushion         = floor(261144 * 0.005) = 1305
      //   marginAdjusted  = min(262144, 261144 + 1305) = 262144
      //   projected 261346 <= 262144 → no overflow, no needless error
      //
      // The projected IS over the compression threshold so compression is
      // triggered, but even with zero reduction the capped margin keeps the
      // payload under the hard limit.
      const s = scenario(ISSUE_CONTEXT_LIMIT);
      // estimate = projected - completionBudget = 261346 - 65536 = 195810
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        195_810,
      );
      s.performCompression.mockImplementation(
        async () => PerformCompressionResult.COMPRESSED,
      );

      const result = await s.enforce();

      expect(result).toContainEqual(s.pending);
      expect(s.performCompression).toHaveBeenCalledOnce();
    });

    it('still triggers compression when projected exceeds the capped cushion limit', async () => {
      // projected = 263000 > 262144 (capped limit) → compression needed
      const s = scenario(ISSUE_CONTEXT_LIMIT);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(197_464); // 197464 + 65536 = 263000 > 262144
      s.performCompression.mockImplementation(async () => {
        historyService.clear();
        historyService.add(makeUserMessage('compressed summary'));
        estimateSpy.mockResolvedValue(1_000);
        return PerformCompressionResult.COMPRESSED;
      });

      const result = await s.enforce();

      expect(textOf(result)).toContain('compressed summary');
      expect(textOf(result)).not.toContain('established history');
      expect(result).toContainEqual(s.pending);
    });
  });

  describe('one-retry-before-truncation: ineffective first compression', () => {
    it('makes exactly one additional full compression attempt when first compression is ineffective (<5%) and second fits', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      // marginAdjustedLimit with 0.5% cushion = 199995
      // First estimate: 150000 + 65536 = 215536 > 199995
      // After 1st compression: 148000 + 65536 = 213536 (reduction <5%)
      // After 2nd compression: 100000 + 65536 = 165536 < 199995 → fits
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);
      let compressionCallCount = 0;
      s.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        if (compressionCallCount === 1) {
          historyService.add(makeUserMessage('first compressed summary'));
          estimateSpy.mockResolvedValue(148_000);
        } else {
          historyService.add(makeUserMessage('second compressed summary'));
          estimateSpy.mockResolvedValue(100_000);
        }
        return PerformCompressionResult.COMPRESSED;
      });

      const result = await s.enforce();

      expect(compressionCallCount).toBe(2);
      expect(textOf(result)).toContain('second compressed summary');
      expect(textOf(result)).not.toContain('first compressed summary');
      expect(result).toContainEqual(s.pending);
      expect(s.fallback).not.toHaveBeenCalled();
    });
  });

  describe('retry remains insufficient, truncation fits', () => {
    it('falls through to truncation when both compression attempts remain over limit, and preserves pending', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);
      let compressionCallCount = 0;
      s.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        historyService.add(makeUserMessage('compressed still large'));
        estimateSpy.mockResolvedValue(148_000);
        return PerformCompressionResult.COMPRESSED;
      });
      s.fallback.mockImplementation(
        truncationFits(estimateSpy, 'truncated history'),
      );

      const result = await s.enforce();

      expect(compressionCallCount).toBe(2);
      expect(s.fallback).toHaveBeenCalled();
      expect(textOf(result)).toContain('truncated history');
      expect(result).toContainEqual(s.pending);
    });
  });

  describe('failure diagnostics', () => {
    it('does not redundantly retry full compression when first compression FAILED, proceeds to truncation', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        150_000,
      );
      let compressionCallCount = 0;
      s.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        historyService.add(makeUserMessage('attempted compression'));
        return PerformCompressionResult.FAILED;
      });

      const thrownError = await thrownBy(() => s.enforce());

      expect(compressionCallCount).toBe(1);
      expect(s.fallback).toHaveBeenCalled();
      expect(thrownError.message).toContain(
        'Automatic compression failed before fallback',
      );
    });

    it('does not redundantly retry full compression when first compression THREW, proceeds to truncation', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        150_000,
      );
      let compressionCallCount = 0;
      s.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        throw new Error('network error during compression');
      });

      const thrownError = await thrownBy(() => s.enforce());

      expect(compressionCallCount).toBe(1);
      expect(s.fallback).toHaveBeenCalled();
      expect(thrownError.message).toContain(
        'Automatic compression failed before fallback',
      );
      expect(thrownError.message).toContain('network error during compression');
    });

    it('proceeds to truncation when the retry compression attempt fails, and includes compression failure diagnostics', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);
      let compressionCallCount = 0;
      s.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        if (compressionCallCount === 1) {
          // First compression succeeds but is ineffective
          historyService.add(makeUserMessage('ineffective compression'));
          estimateSpy.mockResolvedValue(148_000);
          return PerformCompressionResult.COMPRESSED;
        }
        throw new Error('retry compression failed');
      });

      const thrownError = await thrownBy(() => s.enforce());

      expect(compressionCallCount).toBe(2);
      expect(s.fallback).toHaveBeenCalled();
      expect(thrownError.message).toContain(
        'Automatic compression failed before fallback',
      );
      expect(thrownError.message).toContain(
        'Additional hard-limit compression attempt failed',
      );
    });

    it('includes truncation failure details when truncation also fails', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);
      s.performCompression.mockImplementation(async () => {
        historyService.clear();
        historyService.add(makeUserMessage('ineffective compression'));
        estimateSpy.mockResolvedValue(148_000);
        return PerformCompressionResult.COMPRESSED;
      });
      s.fallback.mockRejectedValue(new Error('truncation broke'));

      const thrownError = await thrownBy(() => s.enforce());

      expect(thrownError.message).toContain(
        'Truncation fallback failed during hard-limit enforcement',
      );
      expect(thrownError.message).toContain('truncation broke');
    });
  });
});

describe('provider-source pending boundaries, callbacks and restore (Issue #2588)', () => {
  beforeEach(resetHistory);
  afterEach(restoreMocks);

  describe('unrecoverable boundary preservation (issues #2304/#2306)', () => {
    it('returns rows as-is when the pending boundary is unrecoverable but under capped hard limit', async () => {
      const s = scenario(ISSUE_CONTEXT_LIMIT);
      // projected = 195810 + 65536 = 261346 <= 262144 (capped limit) → as-is
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        195_810,
      );

      const result = await s.enforce(undefined, false);

      expect(textOf(result)).toContain('established history');
      expect(s.performCompression).not.toHaveBeenCalled();
    });

    it('throws unrecoverable-boundary error when the pending boundary is unrecoverable and over capped hard limit', async () => {
      const s = scenario(ISSUE_CONTEXT_LIMIT);
      // projected = 300000 + 65536 = 365536 > 262144 → unrecoverable
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        300_000,
      );

      await expect(s.enforce(undefined, false)).rejects.toThrow(
        /unrecoverable/i,
      );
    });
  });

  // Non-COMPRESSED (skipped) outcomes are treated as ineffective consistently:
  // no redundant retry, proceeds to truncation, diagnostics identify the
  // skipped result.
  describe('non-COMPRESSED skipped results (SKIPPED_EMPTY / SKIPPED_COOLDOWN)', () => {
    it('does not make an additional full retry when first compression returns SKIPPED_EMPTY, proceeds to truncation', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);
      let compressionCallCount = 0;
      s.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        return PerformCompressionResult.SKIPPED_EMPTY;
      });
      s.fallback.mockImplementation(
        truncationFits(estimateSpy, 'truncated history'),
      );

      const result = await s.enforce();

      // A skipped result must NOT trigger a redundant full retry.
      expect(compressionCallCount).toBe(1);
      expect(s.fallback).toHaveBeenCalled();
      expect(result).toContainEqual(s.pending);
    });

    it('does not make an additional full retry when first compression returns SKIPPED_COOLDOWN, proceeds to truncation', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);
      let compressionCallCount = 0;
      s.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        return PerformCompressionResult.SKIPPED_COOLDOWN;
      });
      s.fallback.mockImplementation(
        truncationFits(estimateSpy, 'truncated history'),
      );

      const result = await s.enforce();

      expect(compressionCallCount).toBe(1);
      expect(s.fallback).toHaveBeenCalled();
      expect(result).toContainEqual(s.pending);
    });

    it('retains actionable diagnostics identifying the skipped result when overflow remains after truncation', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        150_000,
      );
      let compressionCallCount = 0;
      s.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        return PerformCompressionResult.SKIPPED_EMPTY;
      });

      const thrownError = await thrownBy(() => s.enforce());

      expect(compressionCallCount).toBe(1);
      expect(thrownError.message).toContain('skipped_empty');
    });
  });

  describe('retry-failure cause preservation', () => {
    it('preserves the underlying retry error message in final diagnostics (not just generic message)', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(150_000);
      let compressionCallCount = 0;
      s.performCompression.mockImplementation(async () => {
        compressionCallCount++;
        historyService.clear();
        if (compressionCallCount === 1) {
          historyService.add(makeUserMessage('ineffective compression'));
          estimateSpy.mockResolvedValue(148_000);
          return PerformCompressionResult.COMPRESSED;
        }
        throw new Error('underlying retry cause: network timeout');
      });

      const thrownError = await thrownBy(() => s.enforce());

      expect(compressionCallCount).toBe(2);
      expect(thrownError.message).toContain(
        'underlying retry cause: network timeout',
      );
    });
  });

  // Provider compression callback contract (issue #2588 regression, updated
  // for issue #3499): the callback runs the full escalation ladder, so a plain
  // compression failure or non-COMPRESSED result no longer aborts it —
  // truncation rescues the request — but the compression failure still
  // surfaces in the structured overflow error when even truncation cannot fit.
  describe('provider compression callback contract (overflow surfaces compressionFailure)', () => {
    async function callbackOverLimit(s: Scenario): Promise<Error> {
      const estimateSpy = vi
        .spyOn(historyService, 'estimateTokensForContents')
        .mockResolvedValue(1_000);
      await s.enforce();
      const callback = s.capturedCallback();
      estimateSpy.mockResolvedValue(150_000);
      return thrownBy(() => callback());
    }

    it('reports the compression failure through the structured overflow error when performCompression throws and truncation cannot fit', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      s.performCompression.mockRejectedValue(
        new Error('callback compression network failure'),
      );

      const error = await callbackOverLimit(s);

      expect(error.message).toContain('callback compression network failure');
    });

    it('reports a non-COMPRESSED result through the structured overflow error when truncation cannot fit', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      s.performCompression.mockResolvedValue(PerformCompressionResult.FAILED);

      const error = await callbackOverLimit(s);

      expect(error.message).toMatch(/Auto compression did not complete/);
    });

    it('consumes structured failures in the pre-send ladder when compression fails (no raw rethrow)', async () => {
      // The pre-send ladder must NOT rethrow the raw compression error; it
      // consumes the structured failure, proceeds to truncation, and surfaces
      // the failure as a diagnostic field of the final overflow error.
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      vi.spyOn(historyService, 'estimateTokensForContents').mockResolvedValue(
        150_000,
      );
      s.performCompression.mockRejectedValue(
        new Error('enforce compression failed'),
      );

      const thrownError = await thrownBy(() => s.enforce());

      expect(s.fallback).toHaveBeenCalled();
      expect(thrownError.message).toContain(
        'Automatic compression failed before fallback',
      );
      expect(thrownError.message).toContain('enforce compression failed');
    });
  });

  describe('data integrity: rejects failed fallback candidate installation', () => {
    it('throws when candidate installation fails even when the candidate projection fits', async () => {
      const s = scenario(STANDARD_CONTEXT_LIMIT);
      const finalizedEstimates = [150_000, 150_000, 135_000, 50_000];
      let estimateIndex = 0;
      s.performCompression.mockImplementation(async () => {
        historyService.clear();
        historyService.add(makeUserMessage('compressed'));
        return PerformCompressionResult.COMPRESSED;
      });
      s.fallback.mockImplementation(async (_promptId, applyResult) => {
        // A candidate whose range cannot be published fails installation,
        // although the estimator would report that the candidate fits.
        const rows = new HistoryDensityRows();
        try {
          rows.appendSanitized(makeUserMessage('truncated history'));
          await applyResult({ rows, start: 99, hasPendingRows: true });
        } finally {
          rows.close();
        }
        return true;
      });

      const thrownError = await thrownBy(() =>
        s.enforce(async () => finalizedEstimates[estimateIndex++] ?? 50_000),
      );

      expect(thrownError.message).toContain(
        'Invalid provider fallback candidate range',
      );
    });
  });

  describe('provider-source restore path under an active compression lock (#3338)', () => {
    it('restores fallback history inside one rebuild scope and keeps late streaming content after release', async () => {
      const s = scenario(2000, { generationConfig: { maxOutputTokens: 100 } });
      s.fallback.mockImplementation(disk.installRestoredFixture);

      // Initial/post-density/post-compression stay over the hard limit so the
      // ladder reaches the restore path; the post-truncation projection then
      // fits, so the ladder returns the restored history.
      const estimates = [500_000, 500_000, 500_000, 100];
      let estimateIndex = 0;
      s.performCompression.mockResolvedValue(PerformCompressionResult.FAILED);

      const observed: string[] = [];
      historyService.on('contentAdded', (content) => {
        const block = content.blocks[0];
        observed.push(
          `contentAdded:${block.type === 'text' ? block.text : block.type}`,
        );
      });
      historyService.on('compressionLockReleased', () => {
        observed.push('compressionLockReleased');
      });
      historyService.on('compressionEnded', () => {
        observed.push('compressionEnded');
      });

      historyService.startCompression();
      await s.enforce(async () => estimates[estimateIndex++] ?? 100);
      historyService.add(makeUserMessage('late stream after restore'));
      historyService.endCompression(makeUserMessage('truncation summary'), 2);

      // #3264 replaced the clear/re-add loop with an atomic
      // HistoryService.replaceAll, so restoring does not announce its own
      // entries as newly added content. The entry that arrives after the lock
      // is released -- which is what #3338 is about -- still streams.
      expect(observed).toStrictEqual([
        'compressionLockReleased',
        'compressionEnded',
        'contentAdded:late stream after restore',
      ]);

      await collectRowsForAssertions(
        historyService.getComprehensive(),
        async (contentsForAssertions) => {
          const texts = contentsForAssertions.map((entry) => {
            const block = entry.blocks[0];
            return block.type === 'text' ? block.text : `<${block.type}>`;
          });
          expect(texts).toStrictEqual([
            'restored-1',
            'restored-2',
            'late stream after restore',
          ]);
          // The truncation restore explicitly reset the post-truncation cache anchor.
          expect(historyService.getCacheAnchorSeq()).toBe(0);
        },
      );
    });
  });
});
