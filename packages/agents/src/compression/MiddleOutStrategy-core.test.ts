import { SettingsService } from '@vybestack/llxprt-code-settings';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
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
 * model, result assembly shape, and layout completeness.
 */

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import {
  compressMiddleOutViaDisk,
  requireMiddleOutApplied,
} from './__tests__/support/middleout-disk-adapter.js';
import {
  buildContext,
  buildCountingContext,
  createCaptureProvider,
  createFakeProvider,
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

describe('MiddleOutStrategy core', () => {
  // -----------------------------------------------------------------------
  // Interface contract
  // -----------------------------------------------------------------------

  describe('interface contract', () => {
    it('has name "middle-out"', () => {
      const strategy = new MiddleOutStrategy(
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(strategy.name).toBe('middle-out');
    });

    it('reports requiresLLM as true', () => {
      const strategy = new MiddleOutStrategy(
        undefined,
        undefined,
        undefined,
        undefined,
      );
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
      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      expect(result.top).toBe(4);
      expect(result.bottom).toBe(4);
      expect(history.length - result.top - result.bottom).toBe(12);
      expect(result.newHistory).toHaveLength(10);
    });

    it('respects custom thresholds for splitting', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({
        history,
        topPreserveThreshold: 0.1,
        preserveThreshold: 0.3,
      });
      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      expect(result.top).toBe(2);
      expect(result.bottom).toBe(6);
      expect(history.length - result.top - result.bottom).toBe(12);
    });
  });

  // -----------------------------------------------------------------------
  // Tool-call boundary respect
  // -----------------------------------------------------------------------

  describe('tool-call boundary respect', () => {
    it('does not orphan tool responses at the top split boundary', async () => {
      const { firstBottom, orphanedTopToolCallIds } =
        await observeDoesNotOrphanToolResponsesAtTheTopSplitBoundary();
      expect(orphanedTopToolCallIds).toStrictEqual([]);
      expect(firstBottom.speaker).not.toBe('tool');
    });

    const observeDoesNotOrphanToolResponsesAtTheTopSplitBoundary = async () => {
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
      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      const topMessages = result.newHistory.slice(0, result.top);
      const bottomMessages = result.newHistory.slice(
        result.newHistory.length - result.bottom,
      );

      // Verify: if the last top message is an AI with tool calls, all of
      // those tool calls must have their responses in the top portion too.
      const lastTop = topMessages[topMessages.length - 1];
      const lastTopToolCalls =
        lastTop.speaker === 'ai'
          ? lastTop.blocks.filter((b) => b.type === 'tool_call')
          : [];
      const orphanedTopToolCallIds = lastTopToolCalls
        .map((call) => (call as { id: string }).id)
        .filter(
          (callId) =>
            Boolean(
              topMessages.some(
                (msg) =>
                  msg.speaker === 'tool' &&
                  msg.blocks.some(
                    (block) =>
                      block.type === 'tool_response' &&
                      'callId' in block &&
                      block.callId === callId,
                  ),
              ),
            ) === false,
        );

      // Bottom messages should not start with an orphaned tool response
      const firstBottom = bottomMessages[0];

      return { firstBottom, orphanedTopToolCallIds };
    };
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
          invocation: captureProviderInvocation(
            {
              fetch: requestFetch,
              runtimeId: testProviderRuntime.runtimeId,
              metadata: testProviderRuntime.metadata,
              globalSettings: new SettingsService().getAllGlobalSettings(),
              providerSettings: new SettingsService().getProviderSettings(
                fakeProvider.name,
              ),
            },
            fakeProvider.name,
          ),
          provider: fakeProvider,
          runtime: testProviderRuntime,
        }),
      });
      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      const topCount = result.top;
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
      const { summaryMsg, profileSummary } =
        await observeUsesTheProfileSpecificProviderWhenCompressionProfileIsSet();
      expect(summaryMsg.blocks[0]).toMatchObject({
        type: 'text',
        text: expect.stringContaining(profileSummary),
      });
    });

    const observeUsesTheProfileSpecificProviderWhenCompressionProfileIsSet =
      async () => {
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

        const ctxWithProfile = buildContext({
          history,
          compressionProfile: 'compression-profile',
          resolveProvider: (profileName?: string) => {
            if (profileName === 'compression-profile') {
              return {
                invocation: captureProviderInvocation(
                  {
                    fetch: requestFetch,
                    runtimeId: testProviderRuntime.runtimeId,
                    metadata: testProviderRuntime.metadata,
                    globalSettings:
                      new SettingsService().getAllGlobalSettings(),
                    providerSettings: new SettingsService().getProviderSettings(
                      profileProvider.name,
                    ),
                  },
                  profileProvider.name,
                ),
                provider: profileProvider,
                runtime: testProviderRuntime,
              };
            }
            return {
              invocation: captureProviderInvocation(
                {
                  fetch: requestFetch,
                  runtimeId: testProviderRuntime.runtimeId,
                  metadata: testProviderRuntime.metadata,
                  globalSettings: new SettingsService().getAllGlobalSettings(),
                  providerSettings: new SettingsService().getProviderSettings(
                    defaultProvider.name,
                  ),
                },
                defaultProvider.name,
              ),
              provider: defaultProvider,
              runtime: testProviderRuntime,
            };
          },
        });
        const profileResult = requireMiddleOutApplied(
          await compressMiddleOutViaDisk(ctxWithProfile),
        );
        const topCount = profileResult.top;
        const summaryMsg = profileResult.newHistory[topCount];

        return { summaryMsg, profileSummary };
      };
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
          return {
            invocation: captureProviderInvocation(
              {
                fetch: requestFetch,
                runtimeId: testProviderRuntime.runtimeId,
                metadata: testProviderRuntime.metadata,
                globalSettings: new SettingsService().getAllGlobalSettings(),
                providerSettings: new SettingsService().getProviderSettings(
                  defaultProvider.name,
                ),
              },
              defaultProvider.name,
            ),
            provider: defaultProvider,
            runtime: testProviderRuntime,
          };
        },
      });

      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      const topCount = result.top;
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
      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      const topCount = result.top;
      const bottomCount = result.bottom;

      expect(result.newHistory).toHaveLength(topCount + 2 + bottomCount);

      for (let i = 0; i < topCount; i++) {
        expect(result.newHistory[i]).toStrictEqual(history[i]);
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
        expect(result.newHistory[topCount + 2 + i]).toStrictEqual(
          history[originalBottomStart + i],
        );
      }
    });

    it('AI acknowledgment message has the expected text', async () => {
      const history = generateHistory(20);
      const ctx = buildContext({ history });
      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );
      const topCount = result.top;

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
  // Layout completeness
  // -----------------------------------------------------------------------

  describe('layout completeness', () => {
    function buildCapturingContext(history: IContent[]) {
      const sent: IContent[] = [];
      const provider = createCaptureProvider(sent);
      const { ctx, providerCalls } = buildCountingContext({
        history,
        resolveProvider: () => ({
          invocation: captureProviderInvocation(
            {
              ...testProviderRuntime,
              fetch: requestFetch,
              globalSettings: {},
              providerSettings: {},
            },
            provider.name,
          ),
          provider,
          runtime: testProviderRuntime,
        }),
      });
      return { ctx, sent, providerCalls };
    }

    function textOf(row: IContent): string {
      return row.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('');
    }

    it('populates all required layout fields', async () => {
      const history = generateHistory(20);
      const { ctx, sent, providerCalls } = buildCapturingContext(history);

      const result = requireMiddleOutApplied(
        await compressMiddleOutViaDisk(ctx),
      );

      expect(
        new MiddleOutStrategy(undefined, undefined, undefined, undefined).name,
      ).toBe('middle-out');
      expect(providerCalls()).toBe(1);
      expect(typeof result.top).toBe('number');
      expect(typeof result.bottom).toBe('number');

      // The rows handed to the summarizer are exactly the middle section, so
      // top + middle + bottom accounts for every original row.
      const sentTexts = new Set(sent.map(textOf));
      const summarized = history.filter((row) => sentTexts.has(textOf(row)));
      const middle = history.slice(result.top, history.length - result.bottom);
      expect(summarized).toStrictEqual(middle);
      expect(result.top + middle.length + result.bottom).toBe(history.length);
      expect(result.newHistory).toHaveLength(result.top + 2 + result.bottom);
    });

    it('calls the provider for a summary when compression occurs', async () => {
      const history = generateHistory(20);
      const { ctx, sent, providerCalls } = buildCapturingContext(history);

      requireMiddleOutApplied(await compressMiddleOutViaDisk(ctx));

      expect(providerCalls()).toBe(1);
      expect(sent.length).toBeGreaterThan(0);
      expect(
        new MiddleOutStrategy(undefined, undefined, undefined, undefined)
          .requiresLLM,
      ).toBe(true);
    });
  });
});
