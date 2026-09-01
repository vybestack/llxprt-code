/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for issue #3473: timing stamps at raw token-bearing
 * deltas in the classic OpenAI stream path.
 *
 * Composes the real processStreamingResponse with the real
 * processStreamWithRecorderGen and a real AttemptRecorder, fed by a
 * synthetic raw chunk iterator that delays between deltas. Emitted
 * ApiResponseEvents are captured at the telemetry logger boundary and fed
 * into a real SessionMetricsAggregator for rate assertions.
 *
 * AC-4: honest stamps at raw reasoning, content, and tool-call deltas.
 * AC-5: reasoning + tool-call-only responses produce a positive window.
 * AC-6: reasoning-only responses produce a positive window.
 * AC-7: visible stream unchanged; raw timing travels to the recorder via
 *       the lifecycle-observer notifier, never as stream output, so timing
 *       stamps cannot affect consumer-visible chunk sequences.
 *
 * Remediation finding F1: raw-delta timing is authoritative. Deferred
 * visible emissions (terminal combined chunk, buffered-text flush) must
 * not overwrite last_token_ms stamped at the final raw delta.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import OpenAI from 'openai';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ApiResponseEvent } from '@vybestack/llxprt-code-core/telemetry/types.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { GemmaToolCallParser } from '@vybestack/llxprt-code-core/parsers/TextToolCallParser.js';
import { initializeTestProviderRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { resetSettingsService } from '@vybestack/llxprt-code-settings';
import {
  SessionMetricsAggregator,
  type ApiAttemptRecord,
} from '@vybestack/llxprt-code-telemetry/telemetry/sessionMetricsAggregator.js';
import { ToolCallPipeline } from '../ToolCallPipeline.js';
import {
  processStreamingResponse,
  type StreamProcessorDeps,
} from '../OpenAIStreamProcessor.js';
import { AttemptRecorder } from '../../logging/attemptRecorder.js';
import {
  processStreamWithRecorderGen,
  type StreamProcessContext,
} from '../../logging/streamProcessor.js';
import { ProviderPerformanceTracker } from '../../logging/ProviderPerformanceTracker.js';

const capturedEvents: ApiResponseEvent[] = [];

const realLoggersModule = {
  ...(await import('@vybestack/llxprt-code-telemetry/telemetry/loggers.js')),
};

// Capture real emitted events at the telemetry infrastructure boundary.
void vi.mock('@vybestack/llxprt-code-telemetry/telemetry/loggers.js', () => ({
  ...realLoggersModule,
  logApiResponse: (_config: unknown, event: ApiResponseEvent) => {
    capturedEvents.push(event);
  },
}));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wire delta shape including the vLLM/DeepSeek reasoning stream field,
 * which the OpenAI SDK types do not model.
 */
type WireDelta = OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string;
};

type WireFinishReason =
  OpenAI.Chat.Completions.ChatCompletionChunk.Choice['finish_reason'];

function makeChunk(
  delta: WireDelta,
  finishReason: WireFinishReason,
  usage?: OpenAI.Chat.Completions.ChatCompletionChunk['usage'],
): OpenAI.Chat.Completions.ChatCompletionChunk {
  const chunk: OpenAI.Chat.Completions.ChatCompletionChunk = {
    id: 'chunk-test',
    object: 'chat.completion.chunk',
    created: 1000000,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
        logprobs: null,
      },
    ],
  };
  if (usage !== undefined) {
    chunk.usage = usage;
  }
  return chunk;
}

async function* createDelayedChunkStream(
  chunks: readonly OpenAI.Chat.Completions.ChatCompletionChunk[],
  delayMs: number,
): AsyncGenerator<
  OpenAI.Chat.Completions.ChatCompletionChunk,
  void,
  undefined
> {
  for (const chunk of chunks) {
    await sleep(delayMs);
    yield chunk;
  }
}

/**
 * Delay between chunks, with an enlarged gap before the final chunk so a
 * deferred terminal emission (combined terminal chunk or buffered-text
 * flush) measurably trails the final raw delta.
 */
async function* createChunkStreamWithTerminalGap(
  chunks: readonly OpenAI.Chat.Completions.ChatCompletionChunk[],
  delayMs: number,
  terminalGapMs: number,
): AsyncGenerator<
  OpenAI.Chat.Completions.ChatCompletionChunk,
  void,
  undefined
> {
  for (const [index, chunk] of chunks.entries()) {
    await sleep(index === chunks.length - 1 ? terminalGapMs : delayMs);
    yield chunk;
  }
}

function makeDeps(): StreamProcessorDeps {
  return {
    toolCallPipeline: new ToolCallPipeline(),
    textToolParser: new GemmaToolCallParser(),
    logger: new DebugLogger('llxprt:test:openai-stream-timing'),
    getBaseURL: () => undefined,
  };
}

function createContext(): StreamProcessContext {
  return {
    providerName: 'test-provider',
    debug: new DebugLogger('llxprt:test:openai-stream-timing'),
    performanceTracker: new ProviderPerformanceTracker('test-provider'),
  };
}

async function collectResults(
  iterator: AsyncIterable<IContent>,
): Promise<IContent[]> {
  const results: IContent[] = [];
  for await (const chunk of iterator) {
    results.push(chunk);
  }
  return results;
}

function collectText(chunks: readonly IContent[]): string {
  let out = '';
  for (const chunk of chunks) {
    for (const block of chunk.blocks) {
      if (block.type === 'text' && 'text' in block) {
        out += block.text;
      }
    }
  }
  return out;
}

function createProviderStream(
  chunks: readonly OpenAI.Chat.Completions.ChatCompletionChunk[],
  delayMs: number,
  format: string,
  options?: {
    rawStream?: AsyncGenerator<
      OpenAI.Chat.Completions.ChatCompletionChunk,
      void,
      undefined
    >;
    onRawTokenDelta?: () => void;
  },
): AsyncGenerator<IContent, void, unknown> {
  return processStreamingResponse(
    options?.rawStream ?? createDelayedChunkStream(chunks, delayMs),
    'test-model',
    format,
    undefined,
    { model: 'test-model', messages: [], stream: true },
    [],
    new OpenAI({ apiKey: 'test-api-key' }),
    undefined,
    undefined,
    { ...makeDeps(), onRawTokenDelta: options?.onRawTokenDelta },
    async function* () {
      yield* [];
    },
  );
}

async function runStreamWithRecorder(
  config: Config,
  chunks: readonly OpenAI.Chat.Completions.ChatCompletionChunk[],
  delayMs: number,
  format: string,
  options?: {
    rawStream?: AsyncGenerator<
      OpenAI.Chat.Completions.ChatCompletionChunk,
      void,
      undefined
    >;
  },
): Promise<{ results: IContent[]; events: ApiResponseEvent[] }> {
  const recorder = new AttemptRecorder({
    providerName: 'test-provider',
    defaultModelName: 'test-model',
    config,
    logicalRequestId: 'req-3473',
    wrapperOwned: true,
  });
  const ctx = createContext();
  recorder.ensureAttemptStarted();

  const wrappedStream = processStreamWithRecorderGen(
    config,
    createProviderStream(chunks, delayMs, format, {
      rawStream: options?.rawStream,
      onRawTokenDelta: () => recorder.onRawTokenDelta(),
    }),
    'test-model',
    'req-3473',
    recorder,
    ctx,
  );

  const results = await collectResults(wrappedStream);
  return { results, events: [...capturedEvents] };
}

function eventToAttemptRecord(event: ApiResponseEvent): ApiAttemptRecord {
  return {
    attemptId: event.attempt_id ?? 'test-attempt',
    model: event.model,
    provider: event.provider ?? 'test-provider',
    isError: false,
    hasUsage: event.usage_metadata_present ?? true,
    inputTokens: event.input_token_count,
    outputTokens: event.output_token_count,
    cachedTokens: event.cached_content_token_count,
    thoughtsTokens: event.thoughts_token_count,
    toolTokens: event.tool_token_count,
    durationMs: event.duration_ms,
    timeToFirstTokenMs: event.time_to_first_token_ms ?? null,
    lastTokenMs: event.last_token_ms ?? null,
    timestampMs: 0,
  };
}

/**
 * Assert the honest timing contract on a captured event: both stamps are
 * positive numbers and the last token strictly follows the first. The
 * null-coalesced sentinel makes an absent stamp fail the first assertion
 * with a clear message instead of requiring non-null assertions.
 */
function expectPositiveTimingWindow(event: ApiResponseEvent): void {
  const ttft = event.time_to_first_token_ms ?? -1;
  const lastToken = event.last_token_ms ?? -1;
  expect(ttft).toBeGreaterThan(0);
  expect(lastToken).toBeGreaterThan(ttft);
}

function makeReasoningChunks(
  count: number,
): OpenAI.Chat.Completions.ChatCompletionChunk[] {
  const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [];
  for (let i = 0; i < count; i++) {
    chunks.push(makeChunk({ reasoning_content: `thinking step ${i}` }, null));
  }
  return chunks;
}

function makeToolCallChunks(
  count: number,
): OpenAI.Chat.Completions.ChatCompletionChunk[] {
  const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = [];
  for (let i = 0; i < count; i++) {
    chunks.push(
      makeChunk(
        {
          tool_calls: [
            {
              index: 0,
              id: 'call_0',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"city":"SF"}',
              },
            },
          ],
        },
        null,
      ),
    );
  }
  return chunks;
}

function makeFinishChunk(
  outputTokens: number,
): OpenAI.Chat.Completions.ChatCompletionChunk {
  return makeChunk({}, 'stop', {
    prompt_tokens: 50,
    completion_tokens: outputTokens,
    total_tokens: 50 + outputTokens,
  });
}

describe('issue #3473: OpenAI stream timing at raw token-bearing deltas', () => {
  let config: Config;

  beforeEach(() => {
    resetSettingsService();
    capturedEvents.length = 0;
    const runtime = initializeTestProviderRuntime({
      runtimeId: `openai-stream-timing-${Math.random().toString(36).slice(2, 10)}`,
      metadata: { suite: 'OpenAIStreamProcessor.timing.test' },
    });
    config = runtime.config;
  });

  // B3: GREEN guard post-remediation: visible stream contract (pins AC-7).
  // Pre-remediation this was RED: the provider stream itself carried
  // metadata-only timing marker chunks (F2).
  it('B3: reasoning + tool-call stream yields exactly one blocks-bearing chunk and no non-visible chunks', async () => {
    const chunks = [
      ...makeReasoningChunks(12),
      ...makeToolCallChunks(3),
      makeFinishChunk(100),
    ];

    const results = await collectResults(
      createProviderStream(chunks, 5, 'openai'),
    );

    // Timing never travels as stream output: the raw provider stream
    // contains only the single terminal combined chunk.
    expect(results).toHaveLength(1);

    const blockTypes = results[0].blocks.map((b) => b.type);
    expect(blockTypes).toContain('thinking');
    expect(blockTypes).toContain('tool_call');
  });

  // B1: RED: reasoning + tool-call timing (AC-4, AC-5)
  it('B1: reasoning + tool-call deltas produce 0 < ttft < last_token_ms', async () => {
    const chunks = [
      ...makeReasoningChunks(12),
      ...makeToolCallChunks(3),
      makeFinishChunk(100),
    ];

    const { results, events } = await runStreamWithRecorder(
      config,
      chunks,
      5,
      'openai',
    );

    expect(events.length).toBe(1);
    const event = events[0];
    expectPositiveTimingWindow(event);

    // Markers are consumed by the wrapper: the consumer sees only the
    // single terminal combined chunk, and usage/finish survive intact.
    expect(results.length).toBe(1);
    expect(results[0].blocks.map((b) => b.type)).toContain('thinking');
    expect(event.output_token_count).toBe(100);
    expect(event.usage_metadata_present).toBe(true);
    expect(event.finish_reasons).toContain('stop');
  });

  // B2: RED: end-to-end aggregator rate (AC-5)
  it('B2: aggregator outputGenerationTps > 0 and < 10_000 for reasoning + tool-call event', async () => {
    const chunks = [
      ...makeReasoningChunks(12),
      ...makeToolCallChunks(3),
      makeFinishChunk(100),
    ];

    const { events } = await runStreamWithRecorder(config, chunks, 5, 'openai');

    expect(events.length).toBe(1);
    const agg = new SessionMetricsAggregator();
    agg.recordApiAttempt(eventToAttemptRecord(events[0]));
    const snap = agg.getSnapshot();

    expect(snap.outputGenerationTps).toBeGreaterThan(0);
    expect(snap.outputGenerationTps).toBeLessThan(10_000);
  });

  // B4: RED: reasoning-only timing (AC-6)
  it('B4: reasoning-only stream produces 0 < ttft < last_token_ms', async () => {
    const chunks = [...makeReasoningChunks(5), makeFinishChunk(100)];

    const { results, events } = await runStreamWithRecorder(
      config,
      chunks,
      5,
      'openai',
    );

    expect(events.length).toBe(1);
    expectPositiveTimingWindow(events[0]);

    const blocksBearing = results.filter((r) => r.blocks.length > 0);
    expect(blocksBearing.length).toBe(1);
    expect(blocksBearing[0].blocks.map((b) => b.type)).toContain('thinking');
  });

  // B5: GREEN guard: content-only regression (AC-4 does not regress)
  it('B5: content-only stream yields text chunks and produces ttft < last_token_ms', async () => {
    const chunks = [
      makeChunk({ content: 'Hello ' }, null),
      makeChunk({ content: 'world ' }, null),
      makeChunk({ content: 'this is a test' }, null),
      makeFinishChunk(20),
    ];

    const { results, events } = await runStreamWithRecorder(
      config,
      chunks,
      5,
      'openai',
    );

    const textChunks = results.filter((r) =>
      r.blocks.some((b) => b.type === 'text'),
    );
    expect(textChunks.length).toBe(3);

    expect(events.length).toBe(1);
    expectPositiveTimingWindow(events[0]);
  });

  // DT-1: RED pre-remediation (F1): buffered text (qwen format) defers the
  // visible flush to finalize; that deferred visible chunk must not
  // overwrite last_token_ms stamped at the final raw text delta.
  it('DT-1: buffered-text flush does not overwrite raw-delta last_token_ms', async () => {
    const chunks = [
      makeChunk({ content: 'Hello' }, null),
      makeChunk({ content: ' world' }, null),
      makeFinishChunk(80),
    ];

    const { results, events } = await runStreamWithRecorder(
      config,
      chunks,
      15,
      'qwen',
      {
        rawStream: createChunkStreamWithTerminalGap(chunks, 15, 150),
      },
    );

    expect(events.length).toBe(1);
    const event = events[0];
    const ttft = event.time_to_first_token_ms ?? -1;
    const lastToken = event.last_token_ms ?? -1;
    expect(ttft).toBeGreaterThan(0);
    const windowMs = lastToken - ttft;
    // Raw span is a single 15ms delta gap. Pre-remediation the deferred
    // flush overwrote the stamp and the window grew past the 150ms gap.
    expect(windowMs).toBeGreaterThan(0);
    expect(windowMs).toBeLessThan(80);

    // The deferred visible flush still updates text, usage, and finish.
    expect(collectText(results)).toContain('Hello world');
    expect(event.output_token_count).toBe(80);
    expect(event.finish_reasons).toContain('stop');
  });

  // DT-2: RED pre-remediation (F1): the terminal combined chunk (reasoning
  // + tool calls emitted at finalize) must not overwrite last_token_ms
  // stamped at the final raw delta.
  it('DT-2: terminal combined emission does not overwrite raw-delta last_token_ms', async () => {
    // The terminal gap is injected before the final (finish) chunk. A
    // window measured at the last raw delta spans only the six 10ms delta
    // gaps; a window measured at the deferred terminal emission would
    // include this gap, so the bound is the gap itself: any window at or
    // above it proves the terminal emission stamped last_token_ms. The
    // bound stays robust to timer jitter (nominal raw span ~60ms) while
    // still excluding the 150ms gap.
    const TERMINAL_GAP_MS = 150;
    const chunks = [
      ...makeReasoningChunks(5),
      ...makeToolCallChunks(1),
      makeFinishChunk(120),
    ];

    const { results, events } = await runStreamWithRecorder(
      config,
      chunks,
      10,
      'openai',
      {
        rawStream: createChunkStreamWithTerminalGap(
          chunks,
          10,
          TERMINAL_GAP_MS,
        ),
      },
    );

    expect(events.length).toBe(1);
    const event = events[0];
    const ttft = event.time_to_first_token_ms ?? -1;
    const lastToken = event.last_token_ms ?? -1;
    expect(ttft).toBeGreaterThan(0);
    const windowMs = lastToken - ttft;
    // Raw span is six 10ms delta gaps (~60ms). Pre-remediation the terminal
    // chunk stamped last_token_ms after the extra 150ms gap (~210ms).
    expect(windowMs).toBeGreaterThan(0);
    expect(windowMs).toBeLessThan(TERMINAL_GAP_MS);

    // The terminal chunk still carries usage, finish, and the single
    // visible combined emission.
    expect(event.output_token_count).toBe(120);
    expect(event.finish_reasons).toContain('stop');
    const blocksBearing = results.filter((r) => r.blocks.length > 0);
    expect(blocksBearing).toHaveLength(1);
  });
});
