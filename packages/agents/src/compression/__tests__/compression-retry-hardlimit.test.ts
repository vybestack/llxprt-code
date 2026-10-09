import { installPendingLegacyStrategyFixture } from './pending-legacy-strategy-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260218-COMPRESSION-RETRY.P01
 * @requirement REQ-1791.1, REQ-1791.2, REQ-1791.3, REQ-1791.4, REQ-1791.5, REQ-1791.6, REQ-2067.1, REQ-2067.2
 *
 * Behavioral tests for hard-limit compression bypass behavior (Issue #1791).
 * Extracted from the original monolithic compression-retry.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import * as compressionFactory from '../compressionStrategyFactory.js';
const realCompressionStrategy = compressionFactory.getCompressionStrategy;
import {
  installSummaryTransport,
  failDiskFallbackEstimation,
  useCompressionClock,
} from './compression-regression-fixtures.js';

import { createChatSessionRuntime } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  makeHttpError,
  makeChatForEnforceContextWindow,
  mockHardLimitRewriteStrategy,
  hardLimitReplacement,
} from './compression-retry-helpers.js';

const original = { ...(await import('@vybestack/llxprt-code-settings')) };
void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...original,
  Storage: {
    ...original.Storage,
    getGlobalConfigDir: vi.fn(() => '/tmp/llxprt-test-config'),
  },
}));

// Mock the delay utility so retryWithBackoff doesn't actually wait in tests
void vi.mock('@vybestack/llxprt-code-core/utils/delay.js', () => ({
  delay: vi.fn().mockResolvedValue(undefined),
  createAbortError: () => {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    return err;
  },
}));

// ---------------------------------------------------------------------------
// Phase 5: Hard-limit compression bypass (Issue #1791)
// ---------------------------------------------------------------------------

let runtimeSetup: ReturnType<typeof createChatSessionRuntime>;
let providerRuntimeSnapshot: ProviderRuntimeContext;

function registerCompressionCase0(): void {
  describe('allows projected tokens within the 0.5% context-limit fudge factor', () => {
    /**
     * @requirement REQ-2067.1
     * Hard-limit gate allows a small estimation cushion before mutating history.
     */
    it('allows projected tokens within the 0.5% context-limit fudge factor', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 149_002,
          contextLimit: 200_000,
          maxOutputTokens: 40_000,
        },
      );

      const getStrategy = vi.spyOn(
        compressionFactory,
        'getCompressionStrategy',
      );

      await expect(
        chat['enforceContextWindow'](10_000, 'test-prompt'),
      ).resolves.toBeUndefined();

      expect(getStrategy).not.toHaveBeenCalled();
    });
  });
}

function registerCompressionCase1(): void {
  describe('still enforces projected tokens beyond the 0.5% context-limit fudge factor', () => {
    /**
     * @requirement REQ-2067.2
     * Hard-limit gate still enforces requests beyond the estimation cushion.
     */
    it('still enforces projected tokens beyond the 0.5% context-limit fudge factor', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 150_000,
          contextLimit: 200_000,
          maxOutputTokens: 40_000,
        },
      );

      let compressionAttempts = 0;

      installSummaryTransport(runtimeSetup.provider, async () => {
        compressionAttempts++;
        return '<state_snapshot>summary</state_snapshot>';
      });
      vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(
        150_000,
      );

      await expect(
        chat['enforceContextWindow'](10_000, 'test-prompt'),
      ).rejects.toThrow('tokensStillNeeded=5');

      expect(compressionAttempts).toBeGreaterThan(0);
    });
  });
}

function registerCompressionCase2(): void {
  describe('bypasses cooldown when enforcing hard context window limit', () => {
    /**
     * @requirement REQ-1791.1
     * enforceContextWindow bypasses cooldown and still attempts compression.
     */
    it('bypasses cooldown when enforcing hard context window limit', async () => {
      useCompressionClock();
      try {
        // Set totalTokens high enough that projected > marginAdjustedLimit
        // marginAdjustedLimit = 200000 - 1000 = 199000
        // projected = totalTokens + pendingTokens + completionBudget
        // With totalTokens=100000, pendingTokens=50000, completionBudget=65536 => 215536 > 199000
        const chat = makeChatForEnforceContextWindow(
          runtimeSetup,
          providerRuntimeSnapshot,
          { totalTokens: 100_000 },
        );

        // Put the chat into cooldown by forcing 3 compression failures
        let primaryAttempts = 0;

        installSummaryTransport(runtimeSetup.provider, async () => {
          primaryAttempts++;
          throw makeHttpError(500);
        });
        failDiskFallbackEstimation(chat.getHistoryService(), () =>
          makeHttpError(500),
        );

        // Trigger cooldown: 3 failures via performCompression
        await chat.performCompression('test-prompt'); // failure 1
        await chat.performCompression('test-prompt'); // failure 2
        await chat.performCompression('test-prompt'); // failure 3 → cooldown

        const attemptsBeforeCooldown = primaryAttempts;

        // 4th performCompression should be skipped (cooldown active)
        await chat.performCompression('test-prompt');
        expect(primaryAttempts).toBe(attemptsBeforeCooldown);

        // Now make compression succeed so enforceContextWindow can get past it
        const succeedAfter = primaryAttempts;

        installSummaryTransport(runtimeSetup.provider, async () => {
          primaryAttempts++;
          if (primaryAttempts <= succeedAfter) throw makeHttpError(500);
          return '<state_snapshot>summary</state_snapshot>';
        });
        failDiskFallbackEstimation(chat.getHistoryService(), () => undefined);

        // Mock getTotalTokens to return a low value after a few calls
        // (simulating compression having succeeded)
        let tokenCallCount = 0;
        vi.spyOn(chat['historyService'], 'getTotalTokens').mockImplementation(
          () => {
            tokenCallCount++;
            // After the initial checks, return low tokens
            if (tokenCallCount > 3) {
              return 10_000; // Well under limit
            }
            return 100_000;
          },
        );

        // enforceContextWindow should bypass cooldown and attempt compression
        await chat['enforceContextWindow'](50_000, 'test-prompt');

        // Compression should have been attempted despite cooldown
        expect(primaryAttempts).toBeGreaterThan(attemptsBeforeCooldown);
      } finally {
        vi.useRealTimers();
      }
    });
  });
}

function registerCompressionCase3(): void {
  describe('forces fallback truncation when compression remains over limit', () => {
    /**
     * @requirement REQ-1791.2
     * When compression remains insufficient, fallback truncation is triggered.
     */
    it('forces fallback truncation when compression remains over limit', async () => {
      // totalTokens=150000, pendingTokens=50000, completionBudget=65536
      // projected = 150000 + 50000 + 65536 = 265536 > 199000
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        { totalTokens: 150_000 },
      );
      installPendingLegacyStrategyFixture(chat.getHistoryService());

      let truncationCalled = false;
      let primaryCallCount = 0;

      vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
        (name) => {
          if (name === 'top-down-truncation') {
            truncationCalled = true;
            return {
              name: 'top-down-truncation' as const,
              requiresLLM: false,
              trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
              compress: vi.fn().mockResolvedValue({
                newHistory: [],
                metadata: {
                  originalMessageCount: 10,
                  compressedMessageCount: 2,
                  strategyUsed: 'top-down-truncation' as const,
                  llmCallMade: false,
                },
              }),
            };
          }
          return realCompressionStrategy(name);
        },
      );
      installSummaryTransport(runtimeSetup.provider, async () => {
        primaryCallCount++;
        return '<state_snapshot>summary</state_snapshot>';
      });

      // Mock getTotalTokens to stay high even after "compression"
      // so the fallback is triggered
      vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(
        150_000,
      );

      // enforceContextWindow should detect ineffective compression and force fallback
      try {
        await chat['enforceContextWindow'](50_000, 'test-prompt');
      } catch {
        // May still throw if tokens remain over limit, but truncation should have been called
      }

      expect(truncationCalled).toBe(true);
      expect(primaryCallCount).toBeGreaterThan(0);
    });
  });
}

function registerCompressionCase4(): void {
  describe('retries full compression before truncating when auto compression is ineffective', () => {
    /**
     * @requirement REQ-2067.3
     * Ineffective auto compression gets one more full compression pass before truncation.
     */
    it('retries full compression before truncating when auto compression is ineffective', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 155_000,
          contextLimit: 200_000,
          maxOutputTokens: 40_000,
        },
      );

      let primaryCallCount = 0;
      let truncationCalled = false;

      vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
        (name) => {
          if (name === 'top-down-truncation') {
            return {
              name: 'top-down-truncation' as const,
              requiresLLM: false,
              trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
              compress: vi.fn().mockImplementation(async () => {
                truncationCalled = true;
                return {
                  newHistory: hardLimitReplacement(),
                  metadata: {
                    originalMessageCount: 10,
                    compressedMessageCount: 1,
                    strategyUsed: 'top-down-truncation' as const,
                    llmCallMade: false,
                  },
                };
              }),
            };
          }
          return realCompressionStrategy(name);
        },
      );
      installSummaryTransport(runtimeSetup.provider, async () => {
        primaryCallCount++;
        return '<state_snapshot>summary</state_snapshot>';
      });

      vi.spyOn(chat['historyService'], 'getTotalTokens').mockImplementation(
        () => {
          if (primaryCallCount >= 2) {
            return 140_000;
          }
          return 155_000;
        },
      );

      await expect(
        chat['enforceContextWindow'](10_000, 'test-prompt'),
      ).resolves.toBeUndefined();

      expect(primaryCallCount).toBe(2);
      expect(truncationCalled).toBe(false);
    });
  });
}

function registerCompressionCase5(): void {
  describe('surfaces failed retry compression diagnostics before truncation failure details', () => {
    /**
     * @requirement REQ-2067.3
     * Failed retry compression is surfaced before hard-limit truncation diagnostics.
     */
    it('surfaces failed retry compression diagnostics before truncation failure details', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 155_000,
          contextLimit: 200_000,
          maxOutputTokens: 40_000,
        },
      );

      let primaryCallCount = 0;
      vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
        (name) => {
          if (name === 'top-down-truncation') {
            return {
              name: 'top-down-truncation' as const,
              requiresLLM: false,
              trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
              compress: vi
                .fn()
                .mockRejectedValue(new Error('truncation broke')),
            };
          }
          return realCompressionStrategy(name);
        },
      );
      installSummaryTransport(runtimeSetup.provider, async () => {
        primaryCallCount++;
        if (primaryCallCount > 1) throw makeHttpError(500);
        return '<state_snapshot>summary</state_snapshot>';
      });
      failDiskFallbackEstimation(chat.getHistoryService(), () =>
        primaryCallCount > 1 ? new Error('truncation broke') : undefined,
      );
      vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(
        155_000,
      );

      await expect(
        chat['enforceContextWindow'](10_000, 'test-prompt'),
      ).rejects.toThrow(
        'Automatic compression failed before fallback: Error: Additional hard-limit compression attempt failed.',
      );

      expect(primaryCallCount).toBeGreaterThan(1);
    });
  });
}

function registerCompressionCase6(): void {
  describe('tries truncation when auto compression returns an empty summary', () => {
    /**
     * @requirement REQ-2067.4
     * Permanent auto-compression failures still allow hard-limit truncation fallback.
     */
    it('tries truncation when auto compression returns an empty summary', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 155_000,
          contextLimit: 200_000,
          maxOutputTokens: 40_000,
        },
      );
      installPendingLegacyStrategyFixture(chat.getHistoryService());

      let fallbackApplied = false;
      vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
        (name) => {
          if (name === 'top-down-truncation') {
            return {
              name: 'top-down-truncation' as const,
              requiresLLM: false,
              trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
              compress: vi.fn().mockImplementation(async () => {
                fallbackApplied = true;
                return {
                  newHistory: [
                    {
                      speaker: 'human',
                      blocks: [{ type: 'text', text: 'truncated' }],
                    },
                  ],
                  metadata: {
                    originalMessageCount: 10,
                    compressedMessageCount: 1,
                    strategyUsed: 'top-down-truncation' as const,
                    llmCallMade: false,
                  },
                };
              }),
            };
          }
          return realCompressionStrategy(name);
        },
      );
      installSummaryTransport(runtimeSetup.provider, async () => '');
      failDiskFallbackEstimation(
        chat.getHistoryService(),
        () => new Error('primary truncation unavailable'),
      );

      vi.spyOn(chat['historyService'], 'getTotalTokens').mockImplementation(
        () => (fallbackApplied ? 140_000 : 155_000),
      );

      await expect(
        chat['enforceContextWindow'](10_000, 'test-prompt'),
      ).resolves.toBeUndefined();

      expect(fallbackApplied).toBe(true);
    });
  });
}

function registerCompressionCase7(): void {
  describe('surfaces non-throwing auto compression failures without retrying full compression', () => {
    /**
     * @requirement REQ-2067.4
     * Non-throwing auto-compression failures are diagnosed and do not trigger a redundant full retry.
     */
    it('surfaces non-throwing auto compression failures without retrying full compression', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 155_000,
          contextLimit: 200_000,
          maxOutputTokens: 40_000,
        },
      );

      let primaryCallCount = 0;
      vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
        (name) => {
          if (name === 'top-down-truncation') {
            return {
              name: 'top-down-truncation' as const,
              requiresLLM: false,
              trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
              compress: vi
                .fn()
                .mockRejectedValue(new Error('truncation broke')),
            };
          }
          return realCompressionStrategy(name);
        },
      );
      installSummaryTransport(runtimeSetup.provider, async () => {
        primaryCallCount++;
        throw makeHttpError(500);
      });
      failDiskFallbackEstimation(
        chat.getHistoryService(),
        () => new Error('truncation broke'),
      );
      vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(
        155_000,
      );

      await expect(
        chat['enforceContextWindow'](10_000, 'test-prompt'),
      ).rejects.toThrow(
        'Automatic compression failed before fallback: Error: Auto compression failed during hard-limit enforcement.',
      );

      expect(primaryCallCount).toBe(3);
    });
  });
}

function registerCompressionCase8(): void {
  describe('surfaces truncation failure details in hard-limit overflow errors', () => {
    /**
     * @requirement REQ-2067.5
     * Hard-limit overflow errors include truncation fallback failure details.
     */
    it('surfaces truncation failure details in hard-limit overflow errors', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 155_000,
          contextLimit: 200_000,
          maxOutputTokens: 40_000,
        },
      );
      installPendingLegacyStrategyFixture(chat.getHistoryService());

      vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
        (name) => {
          if (name === 'top-down-truncation') {
            return {
              name: 'top-down-truncation' as const,
              requiresLLM: false,
              trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
              compress: vi
                .fn()
                .mockRejectedValue(new Error('truncation broke')),
            };
          }
          return realCompressionStrategy(name);
        },
      );
      installSummaryTransport(runtimeSetup.provider);
      vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(
        155_000,
      );

      await expect(
        chat['enforceContextWindow'](10_000, 'test-prompt'),
      ).rejects.toThrow(
        'Truncation fallback failed during hard-limit enforcement: Error: truncation broke',
      );
    });
  });
}

function registerCompressionCase9(): void {
  describe('clears lastPromptTokenCount when hard-limit truncation rewrites history', () => {
    /**
     * @requirement REQ-1791.6
     * Hard-limit fallback rewrite clears stale API prompt baseline.
     */
    it('clears lastPromptTokenCount when hard-limit truncation rewrites history', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 150_000,
          contextLimit: 200_000,
          maxOutputTokens: 65_536,
        },
      );
      installPendingLegacyStrategyFixture(chat.getHistoryService());

      (
        chat as unknown as {
          compressionHandler: { lastPromptTokenCount: number | null };
        }
      ).compressionHandler.lastPromptTokenCount = 95_000;
      const getFallbackApplied = mockHardLimitRewriteStrategy();

      vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(
        150_000,
      );

      await expect(
        chat['enforceContextWindow'](50_000, 'test-prompt'),
      ).rejects.toThrow(Error);

      const fallbackApplied = getFallbackApplied();
      expect(fallbackApplied).toBe(true);
      expect(
        (
          chat as unknown as {
            compressionHandler: { lastPromptTokenCount: number | null };
          }
        ).compressionHandler.lastPromptTokenCount,
      ).toBeNull();

      await collectRowsForAssertions(
        chat.getHistoryService().getComprehensive(),
        async (history) => {
          expect(history).toHaveLength(1);
          const [content] = history;
          expect(content.speaker).toBe('human');
          expect(content.blocks).toStrictEqual([
            { type: 'text', text: 'truncated' },
          ]);
        },
      );
    });
  });
}

function registerCompressionCase10(): void {
  describe('uses lastPromptTokenCount in hard-limit gate projection when available', () => {
    /**
     * @requirement REQ-1791.5
     * Hard-limit gate uses API-observed prompt baseline when available.
     */
    it('uses lastPromptTokenCount in hard-limit gate projection when available', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 1_000,
          contextLimit: 100_000,
          maxOutputTokens: 10_000,
        },
      );

      // If hard-limit gate used raw history (1,000), projection would be:
      // 1,000 + 10,000 + 10,000 = 21,000 <= 99,000 and compression would not run.
      // With API-observed baseline (95,000), projection is:
      // 95,000 + 10,000 + 10,000 = 115,000 > 99,000 and compression should run.
      // Set API-observed prompt baseline directly on compression handler via private field.
      (
        chat as unknown as {
          compressionHandler: { lastPromptTokenCount: number };
        }
      ).compressionHandler.lastPromptTokenCount = 95_000;

      let compressionAttempts = 0;

      installSummaryTransport(runtimeSetup.provider, async () => {
        compressionAttempts++;
        return '<state_snapshot>summary</state_snapshot>';
      });

      vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(1_000);

      try {
        await chat['enforceContextWindow'](10_000, 'test-prompt');
      } catch {
        // We only care that hard-limit path did not early-return and attempted compression.
      }

      expect(compressionAttempts).toBeGreaterThan(0);
    });
  });
}

function registerCompressionCase11(): void {
  describe('includes diagnostic info in error when budget is large relative to context window', () => {
    /**
     * @requirement REQ-1791.3
     * Error message includes reduction amount, completion budget, and budget warning.
     */
    it('includes diagnostic info in error when budget is large relative to context window', async () => {
      // contextLimit=100000, maxOutputTokens=90000 (90% of window)
      // projected = 80000 + 10000 + 90000 = 180000
      // marginAdjustedLimit = 100000 - 1000 = 99000
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        {
          totalTokens: 80_000,
          contextLimit: 100_000,
          maxOutputTokens: 90_000,
        },
      );

      // Make compression return the same history (ineffective)
      vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
        (name) => {
          if (name === 'top-down-truncation') {
            return {
              name: 'top-down-truncation' as const,
              requiresLLM: false,
              trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
              compress: vi.fn().mockResolvedValue({
                newHistory: [
                  {
                    speaker: 'human',
                    blocks: [{ type: 'text', text: 'hello' }],
                  },
                  { speaker: 'ai', blocks: [{ type: 'text', text: 'hi' }] },
                ],
                metadata: {
                  originalMessageCount: 10,
                  compressedMessageCount: 9,
                  strategyUsed: 'top-down-truncation' as const,
                  llmCallMade: false,
                },
              }),
            };
          }
          return realCompressionStrategy(name);
        },
      );
      installSummaryTransport(runtimeSetup.provider);

      // Keep tokens high so nothing reduces enough
      vi.spyOn(chat['historyService'], 'getTotalTokens').mockReturnValue(
        80_000,
      );

      let errorMessage = '';
      try {
        await chat['enforceContextWindow'](10_000, 'test-prompt');
      } catch (err) {
        errorMessage = (err as Error).message;
      }

      expect(errorMessage).toContain(
        'Request still exceeds the safety-adjusted context limit (99495 tokens).',
      );
      expect(errorMessage).toContain(
        'density optimization and compression reduced 0 tokens',
      );
      expect(errorMessage).toContain('completionBudget=90000');
      expect(errorMessage).toContain('tokensStillNeeded=80505');
      expect(errorMessage).toContain(
        'consumes more than 80% of the context window (100000)',
      );
      expect(errorMessage).toContain('Consider lowering maxOutputTokens.');
    });
  });
}

function registerCompressionCase12(): void {
  describe('preserves cooldown behavior when not called from enforceContextWindow', () => {
    /**
     * @requirement REQ-1791.4
     * Cooldown is still respected when bypassCooldown is not set (default behavior).
     */
    it('preserves cooldown behavior when not called from enforceContextWindow', async () => {
      const chat = makeChatForEnforceContextWindow(
        runtimeSetup,
        providerRuntimeSnapshot,
        { totalTokens: 100_000 },
      );

      let compressionAttempts = 0;

      installSummaryTransport(runtimeSetup.provider, async () => {
        compressionAttempts++;
        throw makeHttpError(500);
      });
      failDiskFallbackEstimation(chat.getHistoryService(), () =>
        makeHttpError(500),
      );

      // Force cooldown
      await chat.performCompression('test-prompt'); // failure 1
      await chat.performCompression('test-prompt'); // failure 2
      await chat.performCompression('test-prompt'); // failure 3 → cooldown

      const countAtCooldown = compressionAttempts;

      // Should still skip due to cooldown (not bypassed)
      await chat.performCompression('test-prompt');
      expect(compressionAttempts).toBe(countAtCooldown);
    });
  });
}

describe('Hard-limit compression behavior (Issue #1791)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeSetup = createChatSessionRuntime();
    providerRuntimeSnapshot = {
      ...runtimeSetup.runtime,
      config: runtimeSetup.config,
    };
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  registerCompressionCase0();
  registerCompressionCase1();
  registerCompressionCase2();
  registerCompressionCase3();
  registerCompressionCase4();
  registerCompressionCase5();
  registerCompressionCase6();
  registerCompressionCase7();
  registerCompressionCase8();
  registerCompressionCase9();
  registerCompressionCase10();
  registerCompressionCase11();
  registerCompressionCase12();
});
