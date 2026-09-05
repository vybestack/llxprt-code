/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  StreamEventType,
  type StreamEvent,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import { ChatSession } from './chatSession.js';
import {
  TokenUsageLogger,
  type SerializedTokenUsageRecord,
} from './TokenUsageLogger.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { RAW_TOKEN_DELTA_SINK_KEY } from '@vybestack/llxprt-code-providers';
import { createTokenSyncTestFixture } from './chatSession-tokenSync-helpers.js';

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-raw-')),
    'usage.jsonl',
  );
}

function isSerializedTokenUsageRecord(
  value: unknown,
): value is SerializedTokenUsageRecord {
  if (typeof value !== 'object' || value === null) return false;
  if (!('ts' in value) || typeof value.ts !== 'string') return false;
  if (!('prompt_id' in value) || typeof value.prompt_id !== 'string')
    return false;
  if (!('provider' in value) || typeof value.provider !== 'string')
    return false;
  if (!('model' in value) || typeof value.model !== 'string') return false;
  if (
    !('estimated_tokens' in value) ||
    typeof value.estimated_tokens !== 'number'
  )
    return false;
  if (!('estimator' in value) || typeof value.estimator !== 'string')
    return false;
  if (
    !('tiktoken_tokens' in value) ||
    (typeof value.tiktoken_tokens !== 'number' &&
      value.tiktoken_tokens !== null)
  )
    return false;
  if (
    !('tiktoken_estimation_failed' in value) ||
    typeof value.tiktoken_estimation_failed !== 'boolean'
  )
    return false;
  if (
    !('actual_prompt_tokens' in value) ||
    typeof value.actual_prompt_tokens !== 'number'
  )
    return false;
  if (!('cached_tokens' in value) || typeof value.cached_tokens !== 'number')
    return false;
  return (
    'effective_actual_tokens' in value &&
    typeof value.effective_actual_tokens === 'number'
  );
}

function readJsonl(filePath: string): SerializedTokenUsageRecord[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw.split('\n').map((line) => {
    const parsed: unknown = JSON.parse(line);
    if (!isSerializedTokenUsageRecord(parsed)) {
      throw new Error('Invalid token usage JSONL record');
    }
    return parsed;
  });
}

type ProviderManagerStub = {
  getActiveProvider: unknown;
};

/** Type predicate: the mock provider manager shape used across this file. */
function isProviderManagerStub(
  manager: unknown,
): manager is ProviderManagerStub {
  return (
    typeof manager === 'object' &&
    manager !== null &&
    'getActiveProvider' in manager
  );
}

function providerAdapterFromStub(manager: unknown) {
  if (!isProviderManagerStub(manager)) {
    throw new Error('provider manager stub must expose getActiveProvider()');
  }
  // The stub implements only the member the adapter consumes at runtime;
  // bridged to the structural contract the same way the token-sync fixture
  // bridges its own mocks.
  return createProviderAdapterFromManager(
    manager as unknown as Parameters<
      typeof createProviderAdapterFromManager
    >[0],
  );
}

/** Real-time sleep between simulated deltas (timer-based, Bun-agnostic). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds the runtime-context view every test in this file uses: a ChatSession
 * facing the given provider stub, backed by the token-sync fixture services.
 */
function buildTokenSyncView(
  fixture: ReturnType<typeof createTokenSyncTestFixture>,
  mockProvider: unknown,
  sessionId: string,
) {
  const { mockConfig, historyService, providerRuntimeSnapshot } = fixture;
  const runtimeState: AgentRuntimeState = createAgentRuntimeState({
    runtimeId: fixture.runtimeSetup.runtime.runtimeId ?? 'raw-timing-runtime',
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    sessionId,
  });
  const providerManager = {
    getActiveProvider: vi.fn(() => mockProvider),
  };
  mockConfig.getProviderManager = vi.fn().mockReturnValue(providerManager);
  return createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 200000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
    },
    provider: providerAdapterFromStub(mockConfig.getProviderManager()),
    telemetry: createTelemetryAdapterFromConfig(mockConfig),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime: providerRuntimeSnapshot,
  });
}

/** Reads the raw token-delta sink the agents layer threads into metadata. */
function rawDeltaSinkFrom(
  metadata: Record<string, unknown> | undefined,
): (() => void) | undefined {
  return metadata?.[RAW_TOKEN_DELTA_SINK_KEY] as (() => void) | undefined;
}

/** Collects the text a consumer actually receives from a ChatSession stream. */
async function collectConsumedText(
  stream: AsyncGenerator<StreamEvent>,
): Promise<string> {
  let text = '';
  for await (const event of stream) {
    if (event.type !== StreamEventType.CHUNK) continue;
    for (const block of event.value.content.blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        text += block.text;
      }
    }
  }
  return text;
}

describe('TokenUsageLogger raw token-delta timing (#3493)', () => {
  let logFile: string;

  beforeEach(() => {
    logFile = makeTempLogPath();
  });

  afterEach(() => {
    const dir = path.dirname(logFile);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      // Temp dir cleanup is best-effort; failure here does not affect test outcomes
      process.stderr.write(`Failed to clean up temp dir: ${String(error)}\n`);
    }
  });

  // A reasoning-style buffered stream: raw deltas arrive at the transport
  // while the visible layer defers everything into one terminal chunk. With
  // a single visible chunk, visible-only timing stamps first and last token
  // at the same instant, so generation_ms is omitted entirely. A positive
  // generation_ms can therefore only come from the raw deltas.
  it('derives ttft/generation from raw token deltas for a single-chunk stream (#3493)', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi
        .fn()
        .mockImplementation(async function* (options: {
          metadata?: Record<string, unknown>;
        }) {
          const sink = rawDeltaSinkFrom(options.metadata);
          sink?.();
          await sleep(15);
          sink?.();
          await sleep(15);
          sink?.();
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'The answer is 4.' }],
            metadata: {
              usage: {
                promptTokens: 5000,
                completionTokens: 15,
                totalTokens: 5015,
              },
            },
          };
        }),
    };

    const view = buildTokenSyncView(
      fixture,
      mockProvider,
      'raw-timing-session',
    );

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(realLogger);

    const promptId = 'raw-timing-prompt';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 150,
      estimator: 'anthropic-char',
      tiktokenTokens: 140,
    });

    const stream = await chat.sendMessageStream(
      { message: 'What is 2+2?' },
      promptId,
    );
    for await (const _event of stream) {
      // consume
    }

    await historyService.waitForTokenUpdates();

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.chunk_count).toBe(1);
    expect(record.generation_ms).toBeGreaterThan(0);
    if (
      typeof record.ttft_ms !== 'number' ||
      typeof record.generation_ms !== 'number' ||
      typeof record.provider_request_ms !== 'number'
    ) {
      throw new Error(
        'expected ttft_ms/generation_ms/provider_request_ms to be recorded',
      );
    }
    expect(record.ttft_ms).toBeGreaterThanOrEqual(0);
    expect(record.ttft_ms + record.generation_ms).toBeLessThanOrEqual(
      record.provider_request_ms,
    );
  });

  // AC-3: visible-chunk stamping must stay the timing source when the
  // provider never fires the raw sink (mirrors the #3257 expectations).
  it('keeps visible-chunk timing when no raw signal arrives (#3493 AC-3)', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'The ' }] };
        await sleep(15);
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'answer ' }] };
        await sleep(15);
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'is 4.' }],
          metadata: {
            usage: {
              promptTokens: 5000,
              completionTokens: 15,
              totalTokens: 5015,
            },
          },
        };
      }),
    };

    const view = buildTokenSyncView(
      fixture,
      mockProvider,
      'visible-fallback-session',
    );

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(realLogger);

    const promptId = 'visible-fallback-prompt';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 150,
      estimator: 'anthropic-char',
      tiktokenTokens: 140,
    });

    const stream = await chat.sendMessageStream(
      { message: 'What is 2+2?' },
      promptId,
    );
    for await (const _event of stream) {
      // consume
    }

    await historyService.waitForTokenUpdates();

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.ttft_ms).toBeGreaterThanOrEqual(0);
    expect(record.generation_ms).toBeGreaterThan(0);
    expect(record.provider_request_ms).toBeGreaterThan(0);
    expect(record.chunk_count).toBe(3);
  });

  // The sink rides the same internal metadata channel as the logical
  // request id and must never leak into the consumer-visible stream.
  it('threads the sink on internal metadata only and leaves visible chunks untouched (#3493)', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    const providerOptions: Array<{
      metadata?: Record<string, unknown>;
    }> = [];
    const providerText = 'The answer is 4.';
    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi
        .fn()
        .mockImplementation(async function* (options: {
          metadata?: Record<string, unknown>;
        }) {
          providerOptions.push(options);
          const sink = rawDeltaSinkFrom(options.metadata);
          sink?.();
          await sleep(15);
          sink?.();
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: providerText }],
            metadata: {
              usage: {
                promptTokens: 5000,
                completionTokens: 15,
                totalTokens: 5015,
              },
            },
          };
        }),
    };

    const view = buildTokenSyncView(
      fixture,
      mockProvider,
      'sink-channel-session',
    );

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(realLogger);

    const promptId = 'sink-channel-prompt';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 150,
      estimator: 'anthropic-char',
      tiktokenTokens: 140,
    });

    const stream = await chat.sendMessageStream(
      { message: 'What is 2+2?' },
      promptId,
    );
    const consumedText = await collectConsumedText(stream);

    await historyService.waitForTokenUpdates();

    expect(providerOptions).toHaveLength(1);
    const metadata = providerOptions[0].metadata;
    expect(metadata?.['__logicalRequestId']).toBe(promptId);
    expect(typeof metadata?.[RAW_TOKEN_DELTA_SINK_KEY]).toBe('function');
    expect(consumedText).toBe(providerText);
  });

  /** Drives one full turn against the given provider stub and reads back the serialized records. */
  async function runTurnReadRecords(
    mockProvider: unknown,
    sessionId: string,
    promptId: string,
  ): Promise<SerializedTokenUsageRecord[]> {
    const fixture = createTokenSyncTestFixture();
    const view = buildTokenSyncView(fixture, mockProvider, sessionId);
    const chat = new ChatSession(view, fixture.mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(realLogger);

    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 150,
      estimator: 'anthropic-char',
      tiktokenTokens: 140,
    });

    const stream = await chat.sendMessageStream(
      { message: 'What is 2+2?' },
      promptId,
    );
    for await (const _event of stream) {
      // consume
    }

    await fixture.historyService.waitForTokenUpdates();
    return readJsonl(logFile);
  }

  // A tool-call turn buffered into a single terminal chunk: raw argument
  // fragments fire at the transport while the visible layer defers the whole
  // call. With one visible chunk the visible-only window is zero, so a
  // positive generation_ms can only come from the raw deltas — tool-call-only
  // turns get real generation timing too.
  it('derives generation timing for a buffered tool-call-only stream (#3493)', async () => {
    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi
        .fn()
        .mockImplementation(async function* (options: {
          metadata?: Record<string, unknown>;
        }) {
          const sink = rawDeltaSinkFrom(options.metadata);
          sink?.();
          await sleep(15);
          sink?.();
          await sleep(15);
          sink?.();
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call-1',
                name: 'read_file',
                parameters: { path: 'a.txt' },
              },
            ],
            metadata: {
              usage: {
                promptTokens: 5000,
                completionTokens: 15,
                totalTokens: 5015,
              },
            },
          };
        }),
    };

    const records = await runTurnReadRecords(
      mockProvider,
      'tool-call-buffered-session',
      'tool-call-buffered-prompt',
    );

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.chunk_count).toBe(1);
    expect(record.generation_ms).toBeGreaterThan(0);
  });

  // Buffered text flushed late: raw content deltas arrive early while the
  // provider holds the visible text back. The generation window must track
  // the raw deltas and end BEFORE the late flush, proving the window
  // measures generation rather than visible emission.
  it('ends the raw-derived generation window before a late buffered flush (#3493)', async () => {
    const holdMs = 120;
    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi
        .fn()
        .mockImplementation(async function* (options: {
          metadata?: Record<string, unknown>;
        }) {
          const sink = rawDeltaSinkFrom(options.metadata);
          sink?.();
          await sleep(20);
          sink?.();
          await sleep(20);
          sink?.();
          await sleep(holdMs); // provider buffers the text before flushing
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'The answer is 4.' }],
            metadata: {
              usage: {
                promptTokens: 5000,
                completionTokens: 15,
                totalTokens: 5015,
              },
            },
          };
        }),
    };

    const records = await runTurnReadRecords(
      mockProvider,
      'buffered-late-session',
      'buffered-late-prompt',
    );

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.chunk_count).toBe(1);
    if (
      typeof record.ttft_ms !== 'number' ||
      typeof record.generation_ms !== 'number' ||
      typeof record.provider_request_ms !== 'number'
    ) {
      throw new Error(
        'expected ttft_ms/generation_ms/provider_request_ms to be recorded',
      );
    }
    expect(record.generation_ms).toBeGreaterThan(0);
    // The last raw delta precedes the 120ms hold while provider_request_ms
    // includes it, so the gap is at least the hold; a 50ms bound cannot flake.
    expect(
      record.provider_request_ms - (record.ttft_ms + record.generation_ms),
    ).toBeGreaterThanOrEqual(50);
  });

  // An ordinary text stream interleaves raw deltas with visible chunks; the
  // recorded shape must match the visible-only fallback expectations, so the
  // raw signal does not distort the common case.
  it('records ordinary-stream timing when raw deltas interleave visible chunks (#3493)', async () => {
    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi
        .fn()
        .mockImplementation(async function* (options: {
          metadata?: Record<string, unknown>;
        }) {
          const sink = rawDeltaSinkFrom(options.metadata);
          sink?.();
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'The ' }] };
          await sleep(15);
          sink?.();
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'answer ' }] };
          await sleep(15);
          sink?.();
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'is 4.' }],
            metadata: {
              usage: {
                promptTokens: 5000,
                completionTokens: 15,
                totalTokens: 5015,
              },
            },
          };
        }),
    };

    const records = await runTurnReadRecords(
      mockProvider,
      'ordinary-stream-session',
      'ordinary-stream-prompt',
    );

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.chunk_count).toBe(3);
    expect(record.ttft_ms).toBeGreaterThanOrEqual(0);
    expect(record.generation_ms).toBeGreaterThan(0);
    expect(record.provider_request_ms).toBeGreaterThan(0);
  });

  // A failed attempt that already streamed raw deltas must keep that partial
  // raw timing on its abandoned-attempt record, and the retry must record
  // fresh timing of its own (mirrors the #3257 abandoned/success pair; the
  // raw deltas make the abandoned generation window strictly positive where
  // the visible-only record omitted it).
  it('keeps partial raw timing on an abandoned attempt and fresh timing on the retry (#3493)', async () => {
    let attempt = 0;
    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi
        .fn()
        .mockImplementation(async function* (options: {
          metadata?: Record<string, unknown>;
        }) {
          attempt++;
          if (attempt === 1) {
            const sink = rawDeltaSinkFrom(options.metadata);
            sink?.();
            await sleep(15);
            sink?.();
            await sleep(15);
            sink?.();
            yield {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'partial' }],
              metadata: {
                usage: {
                  promptTokens: 5000,
                  completionTokens: 5,
                  totalTokens: 5005,
                },
              },
            };
            throw new Error('Connection error.');
          }
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'The ' }] };
          await sleep(15);
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'answer ' }] };
          await sleep(15);
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'is 4.' }],
            metadata: {
              usage: {
                promptTokens: 5100,
                completionTokens: 15,
                totalTokens: 5115,
              },
            },
          };
        }),
    };

    const records = await runTurnReadRecords(
      mockProvider,
      'abandoned-raw-timing-session',
      'abandoned-raw-timing-prompt',
    );

    expect(attempt).toBe(2);
    expect(records).toHaveLength(2);

    const abandoned = records.find((r) => r.attempt_outcome === 'abandoned');
    expect(abandoned).toBeDefined();
    if (abandoned === undefined) throw new Error('no abandoned record');
    expect(abandoned.attempt_index).toBe(0);
    expect(typeof abandoned.ttft_ms).toBe('number');
    expect(abandoned.ttft_ms).toBeGreaterThanOrEqual(0);
    // One visible chunk means a zero visible-only window; a positive
    // generation window here can only come from the raw deltas.
    expect(abandoned.generation_ms).toBeGreaterThan(0);
    expect(typeof abandoned.provider_request_ms).toBe('number');
    expect(abandoned.provider_request_ms).toBeGreaterThanOrEqual(0);
    expect(abandoned.chunk_count).toBe(1);

    const success = records.find((r) => r.attempt_outcome !== 'abandoned');
    expect(success).toBeDefined();
    if (success === undefined) throw new Error('no success record');
    expect(success.attempt_index).toBe(1);
    expect(typeof success.ttft_ms).toBe('number');
    expect(success.ttft_ms).toBeGreaterThanOrEqual(0);
    expect(success.generation_ms).toBeGreaterThan(0);
    expect(typeof success.provider_request_ms).toBe('number');
    expect(success.provider_request_ms).toBeGreaterThanOrEqual(0);
    // Fresh attempt-2 timing wins: three chunks, not attempt 1's single one.
    expect(success.chunk_count).toBe(3);
  });

  // Inner retryWithBackoff retry: attempt 1 fires raw deltas then fails
  // BEFORE its first chunk, so the failure lands inside the retry boundary
  // and attempt 2 runs within the same makeApiCallAndProcessStream call.
  // The retry's own generator fires attempt 1's captured sink at a known
  // point — attach runs at generator-body start, before the first provider
  // pull, so the stale call deterministically lands after the retry's
  // tracker is attached. With a shared bridge that stale call stamps the
  // retry's tracker (ttft ~0, generation spanning the stale-to-last-delta
  // gap); with a per-attempt bridge the retry's window holds only its own
  // deltas (ttft past the 80ms sleep, generation near one 15ms sleep).
  it('keeps retry timing free of a late raw delta from the abandoned attempt (#3493)', async () => {
    let staleSink: (() => void) | undefined;
    let attempt = 0;
    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi
        .fn()
        .mockImplementation(async function* (options: {
          metadata?: Record<string, unknown>;
        }) {
          attempt++;
          if (attempt === 1) {
            staleSink = rawDeltaSinkFrom(options.metadata);
            staleSink?.();
            await sleep(15);
            staleSink?.();
            // Fail before the first chunk so the error surfaces inside the
            // retryWithBackoff boundary rather than ChatSession's outer retry.
            throw new Error('Connection error.');
          }
          const sink = rawDeltaSinkFrom(options.metadata);
          // Deterministic late callback from the abandoned attempt's stream.
          staleSink?.();
          await sleep(80);
          sink?.();
          await sleep(15);
          sink?.();
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'The answer is 4.' }],
            metadata: {
              usage: {
                promptTokens: 5100,
                completionTokens: 15,
                totalTokens: 5115,
              },
            },
          };
        }),
    };

    const records = await runTurnReadRecords(
      mockProvider,
      'stale-sink-retry-session',
      'stale-sink-retry-prompt',
    );

    expect(attempt).toBe(2);
    expect(records).toHaveLength(1);
    const success = records[0];
    expect(success.attempt_outcome).toBe('success');
    // One visible chunk, so the timing window can only come from raw deltas.
    expect(success.chunk_count).toBe(1);
    if (
      typeof success.ttft_ms !== 'number' ||
      typeof success.generation_ms !== 'number'
    ) {
      throw new Error('expected ttft_ms/generation_ms to be recorded');
    }
    // The retry's first own delta trails the stale call by a full 80ms
    // sleep; a ttft under 50ms means the stale sink stamped the tracker.
    expect(success.ttft_ms).toBeGreaterThanOrEqual(50);
    // The retry's raw deltas span one 15ms sleep; a window that also
    // covered the stale call would sit near 95ms. Both bounds keep ≥30ms
    // of margin against scheduling noise.
    expect(success.generation_ms).toBeGreaterThan(0);
    expect(success.generation_ms).toBeLessThan(50);
  });
});
