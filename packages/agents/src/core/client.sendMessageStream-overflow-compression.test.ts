/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * sendMessageStream tests: automatic compression recovery for preflight
 * context-overflow (issue #2402).
 * Sibling to client.sendMessageStream-overflow.test.ts (split to avoid
 * file-level max-lines).
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
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import { ChatSession } from './chatSession.js';
import { fromAsync, setupAgentClient } from './client-test-helpers.js';
import {
  client,
  initializeClient,
  disposeClient,
  initializeStream,
  buildOverflowScenario,
  restoreTokenLimit,
  mockTurnRunFn,
  mockChatCreateFn,
  mockGenerateContentFn,
  mockEmbedContentFn,
  MOCKED_TOKEN_LIMIT,
  PREFLIGHT_BASELINE,
  OVERFLOW_REQUEST_CHARS,
  THRESHOLD,
  setClient,
} from './client.sendMessageStream-overflow-compression-fixture.js';

describe('AgentClient — finalized-envelope enforcement handoff (issues 2402, 2755) — deferred enforcement', () => {
  beforeEach(initializeClient);
  afterEach(disposeClient);

  describe('sendMessageStream', () => {
    beforeEach(initializeStream);

    it('should defer unrecoverable enforcement to the finalized provider seam (issue 2755 A3)', async () => {
      const handle = buildOverflowScenario(client, {
        postCompressionBaseline: 950,
        compressionResult: PerformCompressionResult.COMPRESSED,
        enforcementError: new Error('unrecoverable'),
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-enforcement-unrecoverable',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });

    it('should defer insufficient-compression enforcement to the finalized provider seam (issue 2755 A7)', async () => {
      const handle = buildOverflowScenario(client, {
        postCompressionBaseline: 950,
        compressionResult: PerformCompressionResult.COMPRESSED,
        postEnforcementBaseline: 950,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-enforcement-still-too-large',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(0);
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(true);
    });

    it('should defer negative-remaining enforcement to the finalized provider seam (issue 2755 A3)', async () => {
      const handle = buildOverflowScenario(client, {
        postCompressionBaseline: MOCKED_TOKEN_LIMIT + 50,
        compressionResult: PerformCompressionResult.COMPRESSED,
        postEnforcementBaseline: MOCKED_TOKEN_LIMIT + 50,
      });

      const events = await fromAsync(
        client.sendMessageStream(
          handle.request,
          new AbortController().signal,
          'prompt-id-negative-remaining',
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

describe('AgentClient — finalized-envelope enforcement handoff (issues 2402, 2755) — consecutive turns', () => {
  beforeEach(initializeClient);
  afterEach(disposeClient);

  describe('sendMessageStream', () => {
    beforeEach(initializeStream);

    it('should defer overflow detection to finalized provider enforcement for consecutive turns with cleared counts (issue 2755 A4)', async () => {
      (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(
        MOCKED_TOKEN_LIMIT,
      );
      (
        uiTelemetryService.getLastPromptTokenCount as Mock<
          typeof uiTelemetryService.getLastPromptTokenCount
        >
      ).mockReturnValue(0);

      const currentBaseline = PREFLIGHT_BASELINE;

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
        getProjectedPromptBaseline: vi
          .fn()
          .mockImplementation(() => currentBaseline),
        getContextLimit: vi.fn(() => tokenLimit('test-model')),
        performCompression: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(PerformCompressionResult.NOOP),
          ),
        enforceContextWindow: vi
          .fn()
          .mockRejectedValue(new Error('unrecoverable')),
      };
      client['chat'] = mockChat as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      } as Partial<ContentGenerator> as ContentGenerator;

      const longText = 'a'.repeat(OVERFLOW_REQUEST_CHARS);
      const request: ContentBlock[] = [{ type: 'text', text: longText }];
      const signal = new AbortController().signal;

      const events1 = await fromAsync(
        client.sendMessageStream(request, signal, 'prompt-id-first-turn'),
      );

      const overflowEvents1 = events1.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents1).toHaveLength(0);
      expect(events1.some((e) => e.type === AgentEventType.Content)).toBe(true);

      const events2 = await fromAsync(
        client.sendMessageStream(request, signal, 'prompt-id-second-turn'),
      );

      const overflowEvents2 = events2.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents2).toHaveLength(0);
    });
  });
});

describe('AgentClient — finalized-envelope enforcement handoff (issues 2402, 2755) — configured limit', () => {
  beforeEach(initializeClient);
  afterEach(disposeClient);

  describe('sendMessageStream', () => {
    beforeEach(initializeStream);

    it('should leave configured-limit parity to finalized provider enforcement (issue 2755 A7)', async () => {
      const injectedLimit = 842;

      setClient(
        (
          await setupAgentClient(
            { mockChatCreateFn, mockGenerateContentFn, mockEmbedContentFn },
            { useInjectedConfig: true },
          )
        ).client,
      );
      (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(
        MOCKED_TOKEN_LIMIT,
      );
      (
        client as unknown as {
          todoContinuationService: { todoToolsAvailable: boolean };
        }
      ).todoContinuationService.todoToolsAvailable = true;

      const baselineForRecovery = 750;
      const currentBaseline = baselineForRecovery;

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(0),
        getProjectedPromptBaseline: vi
          .fn()
          .mockImplementation(() => currentBaseline),
        getContextLimit: vi.fn().mockReturnValue(injectedLimit),
        performCompression: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(PerformCompressionResult.COMPRESSED),
          ),
        enforceContextWindow: vi
          .fn()
          .mockRejectedValue(new Error('unrecoverable')),
      };
      client['chat'] = mockChat as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      } as Partial<ContentGenerator> as ContentGenerator;
      mockTurnRunFn.mockReturnValue(
        (async function* () {
          yield { type: AgentEventType.Content, value: 'ok' };
        })(),
      );

      const requestCharsForParity = 540;

      const events = await fromAsync(
        client.sendMessageStream(
          [{ type: 'text', text: 'a'.repeat(requestCharsForParity) }],
          new AbortController().signal,
          'prompt-id-parity',
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

describe('AgentClient — finalized-envelope enforcement handoff (issues 2402, 2755) — exact threshold', () => {
  beforeEach(initializeClient);
  afterEach(disposeClient);

  describe('sendMessageStream', () => {
    beforeEach(initializeStream);

    it('should proceed exactly at the threshold boundary where estimated equals remaining * 0.95 (issue 2755 A7 exact threshold)', async () => {
      (tokenLimit as Mock<typeof tokenLimit>).mockReturnValue(
        MOCKED_TOKEN_LIMIT,
      );

      const fitBaseline = 500;
      const requestChars = Math.floor(
        (MOCKED_TOKEN_LIMIT - fitBaseline) * THRESHOLD * 4,
      );
      const exactEstimate = Math.floor(requestChars / 4);

      let currentBaseline = PREFLIGHT_BASELINE;

      const mockChat: Partial<ChatSession> = {
        addHistory: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        getLastPromptTokenCount: vi.fn().mockReturnValue(PREFLIGHT_BASELINE),
        getProjectedPromptBaseline: vi
          .fn()
          .mockImplementation(() => currentBaseline),
        getContextLimit: vi.fn(() => tokenLimit('test-model')),
        performCompression: vi.fn().mockImplementation(() => {
          currentBaseline = fitBaseline;
          return Promise.resolve(PerformCompressionResult.COMPRESSED);
        }),
        enforceContextWindow: vi.fn().mockResolvedValue(undefined),
      };
      client['chat'] = mockChat as ChatSession;
      client['contentGenerator'] = {
        countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
      } as Partial<ContentGenerator> as ContentGenerator;
      mockTurnRunFn.mockReturnValue(
        (async function* () {
          yield { type: AgentEventType.Content, value: 'ok' };
        })(),
      );

      const events = await fromAsync(
        client.sendMessageStream(
          [{ type: 'text', text: 'a'.repeat(requestChars) }],
          new AbortController().signal,
          'prompt-id-threshold-exact',
        ),
      );

      const fitRemaining = MOCKED_TOKEN_LIMIT - fitBaseline;
      expect(exactEstimate).toBe(Math.floor(fitRemaining * THRESHOLD));
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
});

describe('AgentClient — finalized-envelope enforcement handoff (issues 2402, 2755) — provider overflow', () => {
  beforeEach(initializeClient);
  afterEach(disposeClient);

  describe('sendMessageStream', () => {
    beforeEach(initializeStream);

    it('should surface the deferred finalized-envelope overflow exactly once with metadata and no preflight duplicate (issue 2755 A3 surfacing)', async () => {
      // The provider is the authority on overflow. When the finalized provider
      // envelope overflows, the Turn maps it to a single
      // ContextWindowWillOverflow event. The client must propagate exactly that
      // one event (with its metadata) and NOT add its own preflight overflow.
      const providerEstimatedTokens = 1200;
      const providerRemainingTokens = 1000;
      const { request } = buildOverflowScenario(client, {
        postCompressionBaseline: 950,
        compressionResult: PerformCompressionResult.COMPRESSED,
        enforcementError: new Error('unrecoverable'),
      });
      mockTurnRunFn.mockImplementation(() =>
        (async function* () {
          yield {
            type: AgentEventType.ContextWindowWillOverflow,
            value: {
              estimatedRequestTokenCount: providerEstimatedTokens,
              remainingTokenCount: providerRemainingTokens,
            },
          };
        })(),
      );

      const events = await fromAsync(
        client.sendMessageStream(
          request,
          new AbortController().signal,
          'prompt-id-deferred-overflow-surfaces',
        ),
      );

      const overflowEvents = events.filter(
        (e) => e.type === AgentEventType.ContextWindowWillOverflow,
      );
      expect(overflowEvents).toHaveLength(1);
      expect(overflowEvents[0]).toStrictEqual({
        type: AgentEventType.ContextWindowWillOverflow,
        value: {
          estimatedRequestTokenCount: providerEstimatedTokens,
          remainingTokenCount: providerRemainingTokens,
        },
      });
      // No recovery content was produced once the provider overflowed.
      expect(events.some((e) => e.type === AgentEventType.Content)).toBe(false);
    });
  });

  afterAll(restoreTokenLimit);
});
