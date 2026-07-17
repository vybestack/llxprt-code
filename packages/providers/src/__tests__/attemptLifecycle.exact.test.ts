/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Exact lifecycle tests addressing the focused lifecycle review findings #1–#10.
 *
 * These tests replace >= assertions with exact counts and verify:
 * 1. No phantom attempt when external lifecycle owner is present
 * 2. Direct attempt begins before provider invocation; sync throw = 1 error
 * 3. Provider-owned transport: wrapper delegates, never wraps
 * 4. Metadata-only usage updates active attempt independently
 * 5. reasoningTokens/toolTokens extracted; errors carry last token + tokens
 * 6. Streamed text identical logging on/off; no duplicate conversation write
 * 7. Generation TPS only from lastTokenMs - TTFT
 * 8. Token-bearing helper requires nonempty payload
 * 9. AbortError classified aborted; provider errors classified error
 * 10. Exact counts for all scenarios
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry/telemetry/uiTelemetry.js';
import * as sdk from '@vybestack/llxprt-code-telemetry/telemetry/sdk.js';
import { hasTokenBearingOutput } from '../logging/streamChunkUtils.js';
import { extractTokenCountsFromTokenUsage } from '../logging/tokenCounts.js';
import { classifyTerminalStatus } from '../logging/streamProcessor.js';
import { AttemptRecorder } from '../logging/attemptRecorder.js';
import { ProviderPerformanceTracker } from '../logging/ProviderPerformanceTracker.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import * as loggers from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import * as telemetryEmitter from '../logging/telemetryEmitter.js';
import {
  createConfig,
  makeContent,
  makeOptions,
  consumeStream,
  buildStack,
  SuccessProvider,
  SyncThrowProvider,
  MetadataOnlyProvider,
  ConsumerAbortedProvider,
  USAGE_WITH_REASONING,
  USAGE_BASIC,
  SUCCESS_CHUNKS,
} from './attemptLifecycle.helpers.test.js';

// ---- Tests ----

describe('Focused lifecycle review findings', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sdk, 'isTelemetrySdkInitialized').mockReturnValue(false);
    uiTelemetryService.reset();
  });

  // Finding #10: Exact assertions throughout

  describe('#1 no phantom attempt + #10 exact count', () => {
    it('emits exactly 1 attempt for a single successful request with RetryOrchestrator', async () => {
      const config = createConfig(false);
      const wrapper = buildStack(new SuccessProvider(SUCCESS_CHUNKS), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const snap = uiTelemetryService.getSessionSnapshot();
      expect(snap.totalApiRequests).toBe(1);
      expect(snap.totalApiErrors).toBe(0);
    });

    it('pre-abort with zero raw attempts emits zero attempts', async () => {
      // Use an AbortController to pre-abort before any attempt
      const config = createConfig(false);
      const wrapper = buildStack(new SuccessProvider(SUCCESS_CHUNKS), config);
      const controller = new AbortController();
      controller.abort();
      const options = makeOptions(config, makeContent());
      options.invocation = {
        ...(options.invocation ?? {}),
        signal: controller.signal,
      } as never;
      await expect(
        consumeStream(wrapper.generateChatCompletion(options)),
      ).rejects.toThrow(/abort/i);
      const snap = uiTelemetryService.getSessionSnapshot();
      // Zero attempts because pre-abort throws before any attempt is started
      expect(snap.totalApiRequests).toBe(0);
      expect(snap.totalApiErrors).toBe(0);
    });
  });

  describe('#2 direct attempt before provider invocation + sync throw', () => {
    it('synchronous direct throw emits exactly 1 error terminal', async () => {
      const config = createConfig(false);
      // Direct wrapper (no RetryOrchestrator) wrapping a provider that
      // throws synchronously from generateChatCompletion
      const wrapper = new LoggingProviderWrapper(
        new SyncThrowProvider(),
        config,
      );
      wrapper.setRuntimeContextResolver(() => ({
        runtimeId: 'test-exact',
        settingsService: { getConfig: () => config } as never,
        config,
        metadata: {},
      }));
      await expect(
        consumeStream(
          wrapper.generateChatCompletion(makeOptions(config, makeContent())),
        ),
      ).rejects.toThrow('Synchronous throw');
      const snap = uiTelemetryService.getSessionSnapshot();
      // Exactly 1 error terminal record, not 0
      expect(snap.totalApiRequests).toBe(1);
      expect(snap.totalApiErrors).toBe(1);
    });
  });

  describe('#3 provider-owned transport', () => {
    it('wrapper delegates to provider-owned transport (transportAttemptOwnership=provider)', async () => {
      // When transport declares ownership='provider', the wrapper's
      // isWrapperLifecycleOwner returns false. The recorder's
      // ensureAttemptStarted and finalizeAttempt are no-ops.
      // The transport is responsible for firing lifecycle notifications.
      const config = createConfig(false);
      const providerOwned = new SuccessProvider(SUCCESS_CHUNKS, 'provider');
      // Direct wrapper (no RetryOrchestrator)
      const wrapper = new LoggingProviderWrapper(providerOwned, config);
      wrapper.setRuntimeContextResolver(() => ({
        runtimeId: 'test-exact',
        settingsService: { getConfig: () => config } as never,
        config,
        metadata: {},
      }));

      // Since the transport is provider-owned but doesn't fire lifecycle
      // events itself (this test transport doesn't implement AttemptLifecycleOwner),
      // no telemetry will be emitted. This verifies the wrapper delegates.
      const chunks = await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      // Stream completes normally
      expect(chunks).toHaveLength(1);
      // But no telemetry was emitted because wrapper is NOT the owner
      // and the transport doesn't fire lifecycle events
      const snap = uiTelemetryService.getSessionSnapshot();
      expect(snap.totalApiRequests).toBe(0);
    });

    it('AttemptRecorder with wrapperOwned=false ignores ensureAttemptStarted and finalizeAttempt', () => {
      const recorder = new AttemptRecorder({
        providerName: 'test',
        defaultModelName: 'model',
        config: undefined,
        logicalRequestId: 'req1',
        wrapperOwned: false,
      });
      // ensureAttemptStarted returns false and does nothing
      expect(recorder.ensureAttemptStarted()).toBe(false);
      expect(recorder.attemptCount).toBe(0);
      // finalizeAttempt is also a no-op
      recorder.finalizeAttempt('success', 'model');
      expect(recorder.attemptCount).toBe(0);
    });

    it('AttemptRecorder with wrapperOwned=true creates exactly 1 attempt via ensureAttemptStarted', () => {
      const recorder = new AttemptRecorder({
        providerName: 'test',
        defaultModelName: 'model',
        config: undefined,
        logicalRequestId: 'req1',
        wrapperOwned: true,
      });
      expect(recorder.ensureAttemptStarted()).toBe(true);
      expect(recorder.attemptCount).toBe(1);
      // Second call returns false (already started)
      expect(recorder.ensureAttemptStarted()).toBe(false);
      expect(recorder.attemptCount).toBe(1);
    });
  });

  describe('#4 metadata-only usage updates active attempt', () => {
    it('metadata-only chunk updates usage without affecting token timing', () => {
      const recorder = new AttemptRecorder({
        providerName: 'test',
        defaultModelName: 'model',
        config: undefined,
        logicalRequestId: 'req1',
        wrapperOwned: true,
      });
      recorder.ensureAttemptStarted();
      const attemptId = recorder.getCurrentAttemptId()!;
      expect(attemptId).toBeDefined();

      // Record metadata-only usage BEFORE any token-bearing chunk
      recorder.recordMetadataUsage(attemptId, USAGE_BASIC, 'stop');
      const attempt = (
        recorder as unknown as {
          attempts: Map<
            string,
            {
              latestTokenUsage: UsageStats | undefined;
              firstTokenMs: number | null;
              lastTokenMs: number | null;
              finishReasons: string[];
            }
          >;
        }
      ).attempts.get(attemptId)!;
      expect(attempt.latestTokenUsage).toBe(USAGE_BASIC);
      expect(attempt.firstTokenMs).toBeNull();
      expect(attempt.lastTokenMs).toBeNull();
      expect(attempt.finishReasons).toContain('stop');
    });

    it('metadata-only usage flows through full pipeline to telemetry', async () => {
      const config = createConfig(false);
      const usageChunk: IContent = {
        speaker: 'ai',
        blocks: [],
        metadata: { usage: USAGE_WITH_REASONING },
      } as IContent;
      const textChunks: IContent[] = [
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Response text' }],
        } as IContent,
      ];
      const wrapper = buildStack(
        new MetadataOnlyProvider(usageChunk, textChunks),
        config,
      );
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      const snap = uiTelemetryService.getSessionSnapshot();
      // Exactly 1 request recorded
      expect(snap.totalApiRequests).toBe(1);
    });
  });

  describe('#5 reasoningTokens/toolTokens extraction', () => {
    it('extractTokenCountsFromTokenUsage extracts reasoningTokens and toolTokens', () => {
      const debug = {
        debug: vi.fn(),
      } as unknown as Parameters<typeof extractTokenCountsFromTokenUsage>[1];
      const counts = extractTokenCountsFromTokenUsage(
        USAGE_WITH_REASONING,
        debug,
      );
      expect(counts.thoughts_token_count).toBe(30);
      expect(counts.tool_token_count).toBe(15);
    });

    it('errors/aborts carry last token, tokens, and usage presence', () => {
      // Verify the error record path populates last_token_ms and token counts
      const config = createConfig(false);

      const recorder = new AttemptRecorder({
        providerName: 'test',
        defaultModelName: 'model',
        config,
        logicalRequestId: 'req1',
        wrapperOwned: true,
      });
      recorder.ensureAttemptStarted();
      const attemptId = recorder.getCurrentAttemptId()!;

      // Record a token-bearing chunk so lastTokenMs is set
      recorder.recordTokenBearingChunk(attemptId, USAGE_BASIC, 'text', 'stop');

      // Spy on logApiError
      const errorEvents: unknown[] = [];
      vi.spyOn(loggers, 'logApiError').mockImplementation(
        (_cfg: unknown, event: unknown) => {
          errorEvents.push(event);
        },
      );

      recorder.finalizeAttempt('error', 'model', USAGE_BASIC, 'Test error');

      expect(errorEvents).toHaveLength(1);
      const event = errorEvents[0] as Record<string, unknown>;
      expect(event.last_token_ms).not.toBeNull();
      expect(event.input_token_count).toBe(100);
      expect(event.output_token_count).toBe(50);
      expect(event.usage_metadata_present).toBe(true);
      expect(event.provider_owned).toBe(true);
    });
  });

  describe('#6 streamed text identical logging on/off + no duplicate write', () => {
    it('produces identical text content regardless of logging setting', async () => {
      const configOff = createConfig(false);
      const configOn = createConfig(true);

      const chunksOff = await consumeStream(
        buildStack(
          new SuccessProvider(SUCCESS_CHUNKS),
          configOff,
        ).generateChatCompletion(makeOptions(configOff, makeContent())),
      );
      const chunksOn = await consumeStream(
        buildStack(
          new SuccessProvider(SUCCESS_CHUNKS),
          configOn,
        ).generateChatCompletion(makeOptions(configOn, makeContent())),
      );

      const textOff = chunksOff
        .map((c) =>
          c.blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join(''),
        )
        .join('');
      const textOn = chunksOn
        .map((c) =>
          c.blocks
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join(''),
        )
        .join('');

      expect(textOff).toBe(textOn);
    });

    it('conversation response is written exactly once (no duplicate)', async () => {
      const config = createConfig(true);
      const writeSpy = vi.fn();
      // Spy on writeConversationLog
      vi.spyOn(telemetryEmitter, 'writeConversationLog').mockImplementation(
        async () => {
          writeSpy();
        },
      );
      const wrapper = buildStack(new SuccessProvider(SUCCESS_CHUNKS), config);
      await consumeStream(
        wrapper.generateChatCompletion(makeOptions(config, makeContent())),
      );
      // The wrapper's writeResponseLog calls writeConversationLog exactly once
      expect(writeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('#7 generation TPS only from lastTokenMs - TTFT', () => {
    it('TPS is 0 when no lastTokenMs provided (no duration fallback)', () => {
      const tracker = new ProviderPerformanceTracker('test');
      // totalTime=1000, TTFT=200, but no lastTokenMs → TPS stays 0
      tracker.recordCompletion(1000, 200, 500, 250, 10);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBe(0);
    });

    it('TPS is valid when lastTokenMs - TTFT > 0', () => {
      const tracker = new ProviderPerformanceTracker('test');
      // TTFT=200, lastToken=1200 → generation=1000ms → 500 output / 1s = 500 tok/s
      tracker.recordCompletion(1400, 200, 1000, 500, 10, 1200);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBe(500);
    });

    it('TPS is 0 when lastTokenMs <= TTFT', () => {
      const tracker = new ProviderPerformanceTracker('test');
      tracker.recordCompletion(600, 500, 200, 100, 1, 500);
      expect(tracker.getLatestMetrics().tokensPerSecond).toBe(0);
    });
  });

  describe('#8 token-bearing helper requires nonempty payload', () => {
    it('empty text block is NOT token-bearing', () => {
      const chunk = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: '' }],
      } as IContent;
      expect(hasTokenBearingOutput(chunk)).toBe(false);
    });

    it('nonempty text block IS token-bearing', () => {
      const chunk = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'hello' }],
      } as IContent;
      expect(hasTokenBearingOutput(chunk)).toBe(true);
    });

    it('empty thinking block is NOT token-bearing', () => {
      const chunk = {
        speaker: 'ai',
        blocks: [{ type: 'thinking', thought: '' }],
      } as unknown as IContent;
      expect(hasTokenBearingOutput(chunk)).toBe(false);
    });

    it('nonempty thinking block IS token-bearing', () => {
      const chunk = {
        speaker: 'ai',
        blocks: [{ type: 'thinking', thought: 'I think' }],
      } as unknown as IContent;
      expect(hasTokenBearingOutput(chunk)).toBe(true);
    });

    it('empty tool_call (no name) is NOT token-bearing', () => {
      const chunk = {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', name: '', parameters: {} }],
      } as unknown as IContent;
      expect(hasTokenBearingOutput(chunk)).toBe(false);
    });

    it('nonempty tool_call IS token-bearing', () => {
      const chunk = {
        speaker: 'ai',
        blocks: [{ type: 'tool_call', name: 'get_weather', parameters: {} }],
      } as unknown as IContent;
      expect(hasTokenBearingOutput(chunk)).toBe(true);
    });

    it('metadata-only chunk (no blocks) is NOT token-bearing', () => {
      const chunk = {
        speaker: 'ai',
        blocks: [],
        metadata: { usage: USAGE_BASIC },
      } as IContent;
      expect(hasTokenBearingOutput(chunk)).toBe(false);
    });
  });

  describe('#9 abort vs error classification', () => {
    it('AbortError is classified as aborted by classifyTerminalStatus', () => {
      expect(classifyTerminalStatus(createAbortError('test'))).toBe('aborted');
    });

    it('ordinary Error is classified as error by classifyTerminalStatus', () => {
      expect(
        classifyTerminalStatus(new Error('500 Internal Server Error')),
      ).toBe('error');
    });

    it('consumer return from stream is classified as aborted', async () => {
      const config = createConfig(false);
      const provider = new ConsumerAbortedProvider([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'chunk1' }],
        } as IContent,
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'chunk2' }],
        } as IContent,
      ]);
      const wrapper = buildStack(provider, config);
      const stream = wrapper.generateChatCompletion(
        makeOptions(config, makeContent()),
      );
      // Consume first chunk, then call return
      const result = await stream.next();
      expect(result.done).toBe(false);
      await stream.return?.(undefined);
      await vi.waitFor(() => {
        const snap = uiTelemetryService.getSessionSnapshot();
        // 1 request. The abort emits an ApiErrorEvent with error_type='consumer_abort',
        // so totalApiErrors is 1 (abort counts as a terminal error event).
        expect(snap.totalApiRequests).toBe(1);
        expect(snap.totalApiErrors).toBe(1);
      });
    });
  });
});
