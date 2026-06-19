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

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import {
  buildContext,
  generateHistory,
  humanMsg,
  aiTextMsg,
  aiToolCallMsg,
  toolResponseMsg,
  testProviderRuntime,
} from './MiddleOutStrategy-test-helpers.js';

describe('MiddleOutStrategy edge cases', () => {
  // -----------------------------------------------------------------------
  // Minimum compressible
  // -----------------------------------------------------------------------

  describe('minimum compressible', () => {
    it('returns original history when fewer than 4 middle messages', async () => {
      const history = generateHistory(6);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(6);
      expect(result.metadata.compressedMessageCount).toBe(6);
      expect(result.metadata.originalMessageCount).toBe(6);
      expect(result.metadata.llmCallMade).toBe(false);
      expect(result.metadata.strategyUsed).toBe('middle-out');
    });

    it('returns original history for very small conversation', async () => {
      const history = generateHistory(3);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(result.newHistory[i]).toBe(history[i]);
      }
      expect(result.metadata.llmCallMade).toBe(false);
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

      const ctx = buildContext({
        history,
        topPreserveThreshold: 0.3,
        preserveThreshold: 0.3,
      });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(false);
      expect(result.newHistory).toHaveLength(history.length);
      expect(result.metadata.compressedMessageCount).toBe(
        result.metadata.originalMessageCount,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Additional edge cases
  // -----------------------------------------------------------------------

  describe('edge cases', () => {
    it('handles empty history gracefully', async () => {
      const ctx = buildContext({ history: [] });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.newHistory).toHaveLength(0);
      expect(result.metadata.originalMessageCount).toBe(0);
      expect(result.metadata.compressedMessageCount).toBe(0);
      expect(result.metadata.llmCallMade).toBe(false);
    });

    it('handles history with exactly the minimum compressible middle', async () => {
      const history = generateHistory(10);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);
      expect(result.metadata.middleCompressed).toBeGreaterThanOrEqual(4);
    });

    it('provider stream with multiple chunks is aggregated into full summary', async () => {
      const multiChunkProvider: IProvider = {
        name: 'multi-chunk',
        getModels: async () => [],
        getDefaultModel: () => 'fake-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
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
          provider: multiChunkProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);
      const topCount = result.metadata.topPreserved!;
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
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      const bottomStart =
        result.newHistory.length - result.metadata.bottomPreserved!;
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
      expect(bottomTexts).toContain('fix the failing auth test');
    });

    it('does not modify split when last human message is already in toKeepBottom', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      const lastHumanIndex = [...history]
        .reverse()
        .findIndex((m) => m.speaker === 'human');
      const lastHumanOriginalIndex = history.length - 1 - lastHumanIndex;

      const bottomSplitIndex = Math.floor(history.length * (1 - 0.2));
      expect(lastHumanOriginalIndex).toBeGreaterThanOrEqual(bottomSplitIndex);
      expect(result.metadata.llmCallMade).toBe(true);
    });

    it('handles history with no human messages', async () => {
      const history: IContent[] = [];
      for (let i = 0; i < 20; i++) {
        history.push(aiTextMsg(`ai message ${i}`));
      }

      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.strategyUsed).toBe('middle-out');
    });

    it('continuation directive includes last user prompt context when prompt is preserved', async () => {
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
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      expect(ackMsg.speaker).toBe('ai');
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;
      expect(ackText).toContain('most recent request');
    });

    it('handles large last user prompt via context injection', async () => {
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

      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      expect(result.metadata.llmCallMade).toBe(true);
      expect(result.metadata.strategyUsed).toBe('middle-out');

      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];
      const ackText = (ackMsg.blocks[0] as { type: 'text'; text: string }).text;
      expect(ackText).toContain('most recent request');
    });
  });
});
