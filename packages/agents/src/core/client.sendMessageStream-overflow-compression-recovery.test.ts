/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
  type Mock,
} from 'bun:test';
import type { ContentBlock } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { AgentEventType, PerformCompressionResult } from './turn.js';
import { tokenLimit } from '@vybestack/llxprt-code-core/core/tokenLimits.js';
import { ChatSession } from './chatSession.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  buildRuntimeContext,
  buildMockContentGenerator,
  makeUserMessage,
  makeAiText,
} from './__tests__/chatSession-density-helpers.js';
import { fromAsync } from './__tests__/client-test-helpers.js';
import {
  client,
  initializeClient,
  disposeClient,
  initializeStream,
  buildOverflowScenario,
  restoreTokenLimit,
  mockTurnRunFn,
  PREFLIGHT_BASELINE,
} from './__tests__/support/client.sendMessageStream-overflow-compression-fixture.js';
import { collectHistoryFixture } from './__tests__/support/collect-history-test-fixture.js';

describe('AgentClient — finalized-envelope enforcement handoff (issues 2402, 2755)', () => {
  beforeEach(initializeClient);
  afterEach(disposeClient);

  describe('sendMessageStream', () => {
    beforeEach(initializeStream);

    it('should recover via automatic compression and proceed instead of bailing on a small overflow (issue 2402)', async () => {
      const { request } = buildOverflowScenario(client, {
        postCompressionBaseline: 100,
        compressionResult: PerformCompressionResult.COMPRESSED,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-overflow-recovered',
        ),
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: AgentEventType.Content, value: 'ok' }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
    });

    it('should defer compression failure handling to finalized provider enforcement (issue 2402)', async () => {
      const handle = buildOverflowScenario(client, {
        compressionResult: new Error('boom'),
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-overflow-compression-throws',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });

    it('should defer empty-history compression handling to finalized provider enforcement (issue 2402)', async () => {
      const handle = buildOverflowScenario(client, {
        postCompressionBaseline: PREFLIGHT_BASELINE,
        compressionResult: PerformCompressionResult.SKIPPED_EMPTY,
        enforcementError: new Error('unrecoverable'),
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-overflow-skipped-empty',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });
  });
});

describe('AgentClient — finalized-envelope enforcement handoff (issues 2402, 2755) — no-op recovery', () => {
  beforeEach(initializeClient);
  afterEach(disposeClient);

  describe('sendMessageStream', () => {
    beforeEach(initializeStream);

    it('should recover via context-window enforcement when ordinary compression is a no-op (issue 2755 A1)', async () => {
      const ENFORCEMENT_TOKEN_LIMIT = 10_000;
      (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(
        ENFORCEMENT_TOKEN_LIMIT,
      );

      const historyService = new HistoryService();
      const fillText = 'x'.repeat(12_000);
      historyService.add(makeUserMessage(fillText), 'test-model');
      historyService.add(makeAiText(fillText), 'test-model');
      historyService.add(makeUserMessage(fillText), 'test-model');
      await historyService.waitForTokenUpdates();

      const runtimeContext = buildRuntimeContext(historyService, {
        compressionStrategy: 'one-shot',
        contextLimit: ENFORCEMENT_TOKEN_LIMIT,
      });

      const realChat = new ChatSession(
        runtimeContext,
        buildMockContentGenerator(),
        { maxOutputTokens: 100 },
        [],
      );
      client['chat'] = realChat;
      client['contentGenerator'] = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      } as Partial<ContentGenerator> as ContentGenerator;

      mockTurnRunFn.mockReturnValue(
        (async function* () {
          yield { type: AgentEventType.Content, value: 'ok' };
        })(),
      );

      const request: ContentBlock[] = [
        { type: 'text', text: 'x'.repeat(4_000) },
      ];

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-enforcement-recover-noop',
        ),
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: AgentEventType.Content, value: 'ok' }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
      expect((await collectHistoryFixture(realChat.getHistory())).length).toBe(
        3,
      );
    });
  });
});

describe('AgentClient — finalized-envelope enforcement handoff (issues 2402, 2755) — insufficient and failed compression', () => {
  beforeEach(initializeClient);
  afterEach(disposeClient);

  describe('sendMessageStream', () => {
    beforeEach(initializeStream);

    it('should recover via enforcement when compression succeeded but was insufficient (issue 2755 A2)', async () => {
      const { request } = buildOverflowScenario(client, {
        postCompressionBaseline: 950,
        compressionResult: PerformCompressionResult.COMPRESSED,
        postEnforcementBaseline: 100,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-enforcement-recover-insufficient',
        ),
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: AgentEventType.Content, value: 'ok' }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
    });

    it('should recover via enforcement even when ordinary compression returns FAILED (issue 2755 A1 FAILED fallback)', async () => {
      const { request } = buildOverflowScenario(client, {
        postCompressionBaseline: PREFLIGHT_BASELINE,
        compressionResult: PerformCompressionResult.FAILED,
        postEnforcementBaseline: 100,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-enforcement-recover-failed',
        ),
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: AgentEventType.Content, value: 'ok' }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({
          type: AgentEventType.ContextWindowWillOverflow,
        }),
      );
    });
  });
  afterAll(restoreTokenLimit);
});
