/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P05
 * @requirement REQ-CS-002.1, REQ-CS-002.2, REQ-CS-002.3, REQ-CS-002.4
 *
 * Core behavioral tests for MiddleOutStrategy: interface contract, sandwich
 * split, tool-call boundary respect, LLM call, profile resolution, default
 * model, result assembly shape, and metadata completeness.
 */

import { describe, it, expect } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import {
  buildContext,
  createFakeProvider,
  generateHistory,
  humanMsg,
  aiTextMsg,
  aiToolCallMsg,
  toolResponseMsg,
  testProviderRuntime,
} from './MiddleOutStrategy-test-helpers.js';

describe('MiddleOutStrategy core', () => {
  // -----------------------------------------------------------------------
  // Interface contract
  // -----------------------------------------------------------------------

  describe('interface contract', () => {
    it('has name "middle-out"', () => {
      const strategy = new MiddleOutStrategy();
      expect(strategy.name).toBe('middle-out');
    });

    it('reports requiresLLM as true', () => {
      const strategy = new MiddleOutStrategy();
      expect(strategy.requiresLLM).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Sandwich split
  // -----------------------------------------------------------------------

  describe('sandwich split', () => {
    it('produces correct top/middle/bottom counts for 20 messages with default thresholds', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.metadata.topPreserved).toBe(4);
      expect(result.metadata.bottomPreserved).toBe(4);
      expect(result.metadata.middleCompressed).toBe(12);
      expect(result.metadata.originalMessageCount).toBe(20);
      expect(result.newHistory).toHaveLength(10);
    });

    it('respects custom thresholds for splitting', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        topPreserveThreshold: 0.1,
        preserveThreshold: 0.3,
      });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      expect(result.metadata.topPreserved).toBe(2);
      expect(result.metadata.bottomPreserved).toBe(6);
      expect(result.metadata.middleCompressed).toBe(12);
    });
  });

  // -----------------------------------------------------------------------
  // Tool-call boundary respect
  // -----------------------------------------------------------------------

  describe('tool-call boundary respect', () => {
    it('does not orphan tool responses at the top split boundary', async () => {
      const history: IContent[] = [
        humanMsg('msg 0'),
        aiTextMsg('msg 1'),
        humanMsg('msg 2'),
        aiToolCallMsg({ id: 'c1', name: 'search' }),
        toolResponseMsg('c1', 'search', 'found'),
        humanMsg('msg 5'),
        aiTextMsg('msg 6'),
        humanMsg('msg 7'),
        aiTextMsg('msg 8'),
        humanMsg('msg 9'),
        aiTextMsg('msg 10'),
        humanMsg('msg 11'),
        aiTextMsg('msg 12'),
        humanMsg('msg 13'),
        aiTextMsg('msg 14'),
        humanMsg('msg 15'),
        aiTextMsg('msg 16'),
        humanMsg('msg 17'),
        aiTextMsg('msg 18'),
        humanMsg('msg 19'),
      ];

      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      const topMessages = result.newHistory.slice(
        0,
        result.metadata.topPreserved ?? 0,
      );
      const bottomMessages = result.newHistory.slice(
        result.newHistory.length - (result.metadata.bottomPreserved ?? 0),
      );

      // Verify: if the last top message is an AI with tool calls, all of
      // those tool calls must have their responses in the top portion too.
      const lastTop = topMessages[topMessages.length - 1];
      const lastTopToolCalls =
        lastTop.speaker === 'ai'
          ? lastTop.blocks.filter((b) => b.type === 'tool_call')
          : [];
      for (const call of lastTopToolCalls) {
        const callId = (call as { id: string }).id;
        const hasResponse = topMessages.some(
          (msg) =>
            msg.speaker === 'tool' &&
            msg.blocks.some(
              (b) =>
                b.type === 'tool_response' &&
                'callId' in b &&
                b.callId === callId,
            ),
        );
        expect(hasResponse).toBe(true);
      }

      // Bottom messages should not start with an orphaned tool response
      const firstBottom = bottomMessages[0];
      expect(firstBottom.speaker).not.toBe('tool');
    });
  });

  // -----------------------------------------------------------------------
  // LLM call
  // -----------------------------------------------------------------------

  describe('LLM call', () => {
    it('sends middle section to provider and includes returned summary in result', async () => {
      const customSummary =
        'Custom LLM compression summary about the conversation';
      const fakeProvider = createFakeProvider(
        'summary-provider',
        customSummary,
      );
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        resolveProvider: () => ({
          provider: fakeProvider,
          runtime: testProviderRuntime,
        }),
      });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      const topCount = result.metadata.topPreserved!;
      const summaryMessage = result.newHistory[topCount];
      expect(summaryMessage).toBeDefined();
      expect(summaryMessage.speaker).toBe('human');
      expect(summaryMessage.blocks[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining(customSummary),
      });
    });
  });

  // -----------------------------------------------------------------------
  // Profile resolution
  // -----------------------------------------------------------------------

  describe('profile resolution', () => {
    it('uses the profile-specific provider when compressionProfile is set', async () => {
      const profileSummary = 'Summary from profile provider';
      const defaultSummary = 'Summary from default provider';

      const profileProvider = createFakeProvider(
        'profile-provider',
        profileSummary,
      );
      const defaultProvider = createFakeProvider(
        'default-provider',
        defaultSummary,
      );

      const history = generateHistory(20);
      const strategy = new MiddleOutStrategy();

      const ctxWithProfile = buildContext({
        history,
        compressionProfile: 'compression-profile',
        resolveProvider: (profileName?: string) => {
          if (profileName === 'compression-profile') {
            return { provider: profileProvider, runtime: testProviderRuntime };
          }
          return { provider: defaultProvider, runtime: testProviderRuntime };
        },
      });
      const profileResult = await strategy.compress(ctxWithProfile);
      const topCount = profileResult.metadata.topPreserved!;
      const summaryMsg = profileResult.newHistory[topCount];
      expect(summaryMsg.blocks[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining(profileSummary),
      });
    });
  });

  // -----------------------------------------------------------------------
  // Default model
  // -----------------------------------------------------------------------

  describe('default model', () => {
    it('uses default provider when no compression profile is configured', async () => {
      const defaultSummary = 'Default provider summary output';
      const defaultProvider = createFakeProvider('my-default', defaultSummary);

      const history = generateHistory(20);
      let resolvedWithProfileName: string | undefined = 'NOT_CALLED';
      const ctx = buildContext({
        history,
        resolveProvider: (profileName?: string) => {
          resolvedWithProfileName = profileName;
          return { provider: defaultProvider, runtime: testProviderRuntime };
        },
      });

      const strategy = new MiddleOutStrategy();
      const result = await strategy.compress(ctx);

      const topCount = result.metadata.topPreserved!;
      const summaryMsg = result.newHistory[topCount];
      expect(summaryMsg.blocks[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining(defaultSummary),
      });

      expect(resolvedWithProfileName).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Result assembly shape
  // -----------------------------------------------------------------------

  describe('result assembly shape', () => {
    it('produces newHistory of [...top, humanSummary, aiAck, ...bottom]', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);

      const topCount = result.metadata.topPreserved!;
      const bottomCount = result.metadata.bottomPreserved!;

      expect(result.newHistory).toHaveLength(topCount + 2 + bottomCount);

      for (let i = 0; i < topCount; i++) {
        expect(result.newHistory[i]).toBe(history[i]);
      }

      const summaryMsg = result.newHistory[topCount];
      expect(summaryMsg.speaker).toBe('human');
      expect(summaryMsg.blocks).toHaveLength(1);
      expect(summaryMsg.blocks[0].type).toBe('text');

      const ackMsg = result.newHistory[topCount + 1];
      expect(ackMsg.speaker).toBe('ai');
      expect(ackMsg.blocks).toHaveLength(1);
      expect(ackMsg.blocks[0].type).toBe('text');

      const originalBottomStart = history.length - bottomCount;
      for (let i = 0; i < bottomCount; i++) {
        expect(result.newHistory[topCount + 2 + i]).toBe(
          history[originalBottomStart + i],
        );
      }
    });

    it('AI acknowledgment message has the expected text', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);
      const topCount = result.metadata.topPreserved!;
      const ackMsg = result.newHistory[topCount + 1];

      expect(ackMsg.speaker).toBe('ai');
      const textBlock = ackMsg.blocks[0];
      expect(textBlock.type).toBe('text');
      const ackText = (textBlock as { type: 'text'; text: string }).text;
      expect(ackText).toContain('Understood.');
      expect(ackText).toContain('Continuing with the current task.');
    });
  });

  // -----------------------------------------------------------------------
  // Metadata completeness
  // -----------------------------------------------------------------------

  describe('metadata completeness', () => {
    it('populates all required metadata fields', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);
      const meta = result.metadata;

      expect(meta.originalMessageCount).toBe(20);
      expect(meta.compressedMessageCount).toBe(result.newHistory.length);
      expect(meta.strategyUsed).toBe('middle-out');
      expect(meta.llmCallMade).toBe(true);
      expect(typeof meta.topPreserved).toBe('number');
      expect(typeof meta.bottomPreserved).toBe('number');
      expect(typeof meta.middleCompressed).toBe('number');

      expect(
        meta.topPreserved! + meta.middleCompressed! + meta.bottomPreserved!,
      ).toBe(meta.originalMessageCount);
      expect(meta.compressedMessageCount).toBe(
        meta.topPreserved! + 2 + meta.bottomPreserved!,
      );
    });

    it('sets llmCallMade to true when compression occurs', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const strategy = new MiddleOutStrategy();

      const result = await strategy.compress(ctx);
      expect(result.metadata.llmCallMade).toBe(true);
    });
  });
});
