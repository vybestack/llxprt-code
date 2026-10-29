import { SettingsService } from '@vybestack/llxprt-code-settings';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P05
 * @requirement REQ-CS-002.5, REQ-CS-002.6
 *
 * Edge-case behavioral tests for MiddleOutStrategy: minimum compressible,
 * empty middle after boundary adjustment, edge cases, and last user prompt
 * preservation.
 */

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import {
  compressMiddleOutViaDisk,
  requireMiddleOutApplied,
} from './__tests__/support/middleout-disk-adapter.js';
import {
  buildContext,
  buildCountingContext,
  generateHistory,
  humanMsg,
  aiTextMsg,
  aiToolCallMsg,
  toolResponseMsg,
  testProviderRuntime,
} from './__tests__/MiddleOutStrategy-test-helpers.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

const requestFetch: NetworkFetch = () =>
  Promise.reject(new Error('This test must not make network requests'));

describe('MiddleOutStrategy edge cases', () => {
  // -----------------------------------------------------------------------
  // Minimum compressible
  // -----------------------------------------------------------------------

  describe('minimum compressible', () => {
    it('returns original history when fewer than 4 middle messages', async () => {
      const history = generateHistory(6);
      const { ctx, providerCalls } = buildCountingContext({ history });

      const result = await compressMiddleOutViaDisk(ctx);

      // The disk noop carries no reason or counts; the observable facts are
      // that the history is left as-is (no candidate rows), no LLM call was
      // made, and the strategy is middle-out.
      expect(result).toStrictEqual({ kind: 'noop', candidateRows: 0 });
      expect(providerCalls()).toBe(0);
      expect(
        new MiddleOutStrategy(undefined, undefined, undefined, undefined).name,
      ).toBe('middle-out');
    });

    it('returns original history for very small conversation', async () => {
      const history = generateHistory(3);
      const { ctx, providerCalls } = buildCountingContext({ history });

      const result = await compressMiddleOutViaDisk(ctx);

      expect(result).toStrictEqual({ kind: 'noop', candidateRows: 0 });
      expect(providerCalls()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Empty middle after boundary adjustment
  // -----------------------------------------------------------------------

  describe('empty middle after boundary adjustment', () => {
    it('returns original when tool-call boundary adjustment eliminates the middle', async () => {
      const history: IContent[] = [
        humanMsg('start'),
        aiTextMsg('thinking'),
        aiToolCallMsg({ id: 'c1', name: 'big_search' }),
        toolResponseMsg('c1', 'big_search', 'lots of data'),
        toolResponseMsg('c1', 'big_search', 'more data'),
        toolResponseMsg('c1', 'big_search', 'even more'),
        toolResponseMsg('c1', 'big_search', 'final chunk'),
        humanMsg('ok what did you find'),
        aiTextMsg('here is what I found'),
        humanMsg('thanks'),
      ];

      const { ctx, providerCalls } = buildCountingContext({
        history,
        topPreserveThreshold: 0.3,
        preserveThreshold: 0.3,
      });
      const result = await compressMiddleOutViaDisk(ctx);

      expect(result).toStrictEqual({ kind: 'noop', candidateRows: 0 });
      expect(providerCalls()).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty history gracefully', async () => {
      const { ctx, providerCalls } = buildCountingContext({ history: [] });

      const result = await compressMiddleOutViaDisk(ctx);

      expect(result).toStrictEqual({ kind: 'noop', candidateRows: 0 });
      expect(providerCalls()).toBe(0);
    });

    it('handles history with exactly the minimum compressible middle', async () => {
      const history = generateHistory(10);
      const { ctx, providerCalls } = buildCountingContext({ history });

      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      expect(providerCalls()).toBe(1);
      expect(
        history.length - result.top - result.bottom,
      ).toBeGreaterThanOrEqual(4);
    });

    it('provider stream with multiple chunks is aggregated into full summary', async () => {
      const multiChunkProvider: IProvider = {
        name: 'multi-chunk',
        getModels: async () => [],
        getDefaultModel: () => 'fake-model',
        async *generateChatCompletion() {
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'First part. ' }],
          };
          yield {
            speaker: 'ai' as const,
            blocks: [{ type: 'text' as const, text: 'Second part.' }],
          };
        },
      } as unknown as IProvider;

      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          invocation: captureProviderInvocation(
            {
              fetch: requestFetch,
              runtimeId: testProviderRuntime.runtimeId,
              metadata: testProviderRuntime.metadata,
              globalSettings: new SettingsService().getAllGlobalSettings(),
              providerSettings: new SettingsService().getProviderSettings(
                multiChunkProvider.name,
              ),
            },
            multiChunkProvider.name,
          ),
          provider: multiChunkProvider,
          runtime: testProviderRuntime,
        }),
      });

      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );
      const topCount = result.top;
      const summaryMsg = result.newHistory[topCount];
      const summaryText = (summaryMsg.blocks[0] as { text: string }).text;

      expect(summaryText).toContain('First part.');
      expect(summaryText).toContain('Second part.');
    });
  });

  // -----------------------------------------------------------------------
  // Last user prompt preservation
  // -----------------------------------------------------------------------

  describe('last user prompt preservation', () => {
    it('preserves short last user prompt literally when it falls in toCompress', async () => {
      const { bottomTexts } =
        await observePreservesShortLastUserPromptLiterallyWhenItFallsInToCompress();
      expect(bottomTexts).toContain('fix the failing auth test');
    });

    const observePreservesShortLastUserPromptLiterallyWhenItFallsInToCompress =
      async () => {
        const history: IContent[] = [];
        for (let i = 0; i < 20; i++) {
          if (i === 10) {
            history.push(humanMsg('fix the failing auth test'));
          } else if (i <= 10 && i % 2 === 0) {
            history.push(humanMsg(`user message ${i}`));
          } else {
            history.push(aiTextMsg(`ai response ${i}`));
          }
        }

        const ctx = buildContext({ history });
        const result = requireMiddleOutApplied(
          await compressMiddleOutViaDisk(ctx),
        );

        const bottomStart = result.newHistory.length - result.bottom;
        const bottomMessages = result.newHistory.slice(bottomStart);
        const bottomTexts = bottomMessages
          .filter((m) => m.speaker === 'human')
          .flatMap((m) =>
            m.blocks
              .filter(
                (b): b is { type: 'text'; text: string } => b.type === 'text',
              )
              .map((b) => b.text),
          );

        return { bottomTexts };
      };

    it('does not modify split when last human message is already in toKeepBottom', async () => {
      const history = generateHistory(20);
      const { ctx, providerCalls } = buildCountingContext({ history });

      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      const lastHumanIndex = [...history]
        .reverse()
        .findIndex((m) => m.speaker === 'human');
      const lastHumanOriginalIndex = history.length - 1 - lastHumanIndex;

      const bottomSplitIndex = Math.floor(history.length * (1 - 0.2));
      expect(lastHumanOriginalIndex).toBeGreaterThanOrEqual(bottomSplitIndex);
      expect(providerCalls()).toBe(1);
      expect(result.newHistory[result.top].metadata?.isSummary).toBe(true);
    });

    it('handles history with no human messages', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        history.push(aiTextMsg(`ai message ${i}`));
      }

      const ctx = buildContext({ history });
      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      expect(
        new MiddleOutStrategy(undefined, undefined, undefined, undefined).name,
      ).toBe('middle-out');
      expect(result.newHistory[result.top].metadata?.isSummary).toBe(true);
    });

    it('continuation directive includes last user prompt context when prompt is preserved', async () => {
      const { ackMsg, ackText } =
        await observeContinuationDirectiveIncludesLastUserPromptContextWhenPromptIsPreserved();
      expect(ackMsg.speaker).toBe('ai');
      expect(ackText).toContain('most recent request');
    });

    const observeContinuationDirectiveIncludesLastUserPromptContextWhenPromptIsPreserved =
      async () => {
        const history: IContent[] = [];
        for (let i = 0; i < 20; i++) {
          if (i === 8) {
            history.push(humanMsg('please fix the database connection issue'));
          } else if (i % 2 === 0) {
            history.push(humanMsg(`user message ${i}`));
          } else {
            history.push(aiTextMsg(`ai response ${i}`));
          }
        }

        const ctx = buildContext({ history });
        const result = requireMiddleOutApplied(
          await compressMiddleOutViaDisk(ctx),
        );

        const topCount = result.top;
        const ackMsg = result.newHistory[topCount + 1];

        const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string })
          .text;

        return { ackMsg, ackText };
      };

    it('handles large last user prompt via context injection', async () => {
      const { result, ackText, providerCalls } =
        await observeHandlesLargeLastUserPromptViaContextInjection();
      expect(providerCalls).toBe(1);
      expect(
        new MiddleOutStrategy(undefined, undefined, undefined, undefined).name,
      ).toBe('middle-out');
      expect(result.newHistory[result.top].metadata?.isSummary).toBe(true);
      expect(ackText).toContain('most recent request');
    });

    const observeHandlesLargeLastUserPromptViaContextInjection = async () => {
      const longText = 'x'.repeat(5000);
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        if (i === 8) {
          history.push(humanMsg(longText));
        } else if (i % 2 === 0) {
          history.push(humanMsg(`user message ${i}`));
        } else {
          history.push(aiTextMsg(`ai response ${i}`));
        }
      }

      const { ctx, providerCalls } = buildCountingContext({ history });
      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      const topCount = result.top;
      const ackMsg = result.newHistory[topCount + 1];
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;

      return { result, ackText, providerCalls: providerCalls() };
    };
  });
});
