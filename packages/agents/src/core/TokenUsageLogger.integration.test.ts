/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { InvalidStreamError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
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
import { createTokenSyncTestFixture } from './chatSession-tokenSync-helpers.js';

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-int-')),
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
  return createProviderAdapterFromManager(manager);
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
    runtimeId: fixture.runtimeSetup.runtime.runtimeId,
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

describe('TokenUsageLogger integration — ChatSession streaming', () => {
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

  it('pairs estimate with actual after a normal streaming turn', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'What is 2+2?' }],
      },
      'claude-3-5-sonnet-20241022',
    );
    await historyService.waitForTokenUpdates();

    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'The answer is 4.' }],
        };
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: 5000,
              completionTokens: 15,
              totalTokens: 5015,
            },
          },
          usageMetadata: {
            promptTokenCount: 5000,
            candidatesTokenCount: 15,
            totalTokenCount: 5015,
          },
        };
      }),
    };

    const view = buildTokenSyncView(fixture, mockProvider, 'int-test-session');

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(realLogger);

    const promptId = 'int-prompt-1';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 150,
      estimator: 'anthropic-char',
      tiktokenTokens: 140,
    });

    const stream = await chat.sendMessageStream(
      { message: [{ text: 'What is 2+2?' }] },
      promptId,
    );
    for await (const _event of stream) {
      // consume
    }

    await historyService.waitForTokenUpdates();

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.prompt_id).toBe(promptId);
    expect(record.estimated_tokens).toBe(150);
    expect(record.actual_prompt_tokens).toBe(5000);
    expect(record.cached_tokens).toBe(0);
    expect(record.effective_actual_tokens).toBe(5000);
  });

  it('records cached_tokens and effective_actual_tokens for cached turns', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello there' }],
      },
      'claude-3-5-sonnet-20241022',
    );
    await historyService.waitForTokenUpdates();

    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hi!' }],
        };
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: 5000,
              completionTokens: 10,
              totalTokens: 5010,
              cache_read_input_tokens: 2000,
            },
          },
          usageMetadata: {
            promptTokenCount: 5000,
            candidatesTokenCount: 10,
            totalTokenCount: 5010,
            cachedContentTokenCount: 2000,
          },
        };
      }),
    };

    const view = buildTokenSyncView(
      fixture,
      mockProvider,
      'int-test-session-2',
    );

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(realLogger);

    const promptId = 'int-prompt-2';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 300,
      estimator: 'anthropic-char',
      tiktokenTokens: 280,
    });

    const stream = await chat.sendMessageStream(
      { message: [{ text: 'Hello there' }] },
      promptId,
    );
    for await (const _event of stream) {
      // consume
    }

    await historyService.waitForTokenUpdates();

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.prompt_id).toBe(promptId);
    expect(record.actual_prompt_tokens).toBe(5000);
    expect(record.cached_tokens).toBe(2000);
    expect(record.effective_actual_tokens).toBe(3000);
  });

  // AC-12: Bidirectional join — the token-usage turn record's join keys
  // locate the conversation turn, and the persisted content carries the
  // matching promptId. End-to-end through a real ChatSession, not mocks.
  it('AC-12 bidirectional join: turn record keys match history content promptId', async () => {
    const {
      records,
      record,
      fixture,
      sentTurn,
      promptId,
      turnIdObservation,
      promptIdObservation,
    } =
      await observeAC12BidirectionalJoinTurnRecordKeysMatchHistoryContentPromptId();
    expect(records).toHaveLength(1);
    expect(record.session_id).toBe('ac12-join-session');
    expect(record.runtime_id).toBe(fixture.runtimeSetup.runtime.runtimeId);
    expect(record.parent_runtime_id).toBeNull();
    expect(record.subagent_name).toBeNull();
    expect(sentTurn).toBeDefined();
    expect(record.turn_id).not.toBeNull();
    expect(record.turn_id).toBe(turnIdObservation);
    expect(promptIdObservation).toBe(promptId);
    expect(record.prompt_id).toBe(promptId);
  });

  const observeAC12BidirectionalJoinTurnRecordKeysMatchHistoryContentPromptId =
    async () => {
      const fixture = createTokenSyncTestFixture();
      const mockContentGenerator = fixture.mockContentGenerator;
      const historyService = fixture.historyService;

      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Hello!' }],
          };
          yield {
            speaker: 'ai',
            blocks: [],
            metadata: {
              usage: {
                promptTokens: 4000,
                completionTokens: 10,
                totalTokens: 4010,
              },
            },
            usageMetadata: {
              promptTokenCount: 4000,
              candidatesTokenCount: 10,
              totalTokenCount: 4010,
            },
          };
        }),
      };

      const view = buildTokenSyncView(
        fixture,
        mockProvider,
        'ac12-join-session',
      );

      const chat = new ChatSession(view, mockContentGenerator, {}, []);

      const realLogger = new TokenUsageLogger(true, logFile);
      chat.setTokenUsageLoggerForTesting(realLogger);

      const promptId = 'ac12-join-prompt';
      realLogger.recordEstimate(promptId, {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        estimatedTokens: 200,
        estimator: 'anthropic-char',
        tiktokenTokens: 180,
      });

      const stream = await chat.sendMessageStream(
        { message: [{ text: 'Say hello' }] },
        promptId,
      );
      for await (const _event of stream) {
        // consume
      }

      await historyService.waitForTokenUpdates();

      // --- Assert token-usage record carries the join keys ---
      const records = readJsonl(logFile);

      const record = records[0];

      // AC-1 join keys must be present

      // Main agent: no parent runtime, no subagent name

      // --- The join must resolve to the turn THIS send created (AC-1/AC-2) ---
      // This is the first turn of the session: there is no earlier turn the
      // record could accidentally name, so a stale or null turn_id fails here.
      const allHistory = historyService.getAll();
      const sentTurn = allHistory.find((c) => c.speaker === 'human');

      if (sentTurn === undefined)
        throw new Error('expected a human turn in history');
      // usage record -> conversation turn

      // conversation turn -> usage record

      const turnIdObservation = sentTurn.metadata?.turnId;
      const promptIdObservation = sentTurn.metadata?.promptId;
      return {
        records,
        record,
        fixture,
        sentTurn,
        promptId,
        turnIdObservation,
        promptIdObservation,
      };
    };

  // AC-12: Cached turn — provider reports Anthropic-style cache read+write.
  // The JSONL must carry both cache_read_tokens and cache_write_tokens, and
  // legacy cached_tokens / effective_actual_tokens must remain unchanged.
  it('AC-12 cached turn: records cache_read_tokens and cache_write_tokens with legacy fields intact', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    historyService.add(
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Tell me about caching' }],
      },
      'claude-3-5-sonnet-20241022',
    );
    await historyService.waitForTokenUpdates();

    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Caching helps.' }],
        };
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: 5000,
              completionTokens: 10,
              totalTokens: 5010,
              cache_read_input_tokens: 2000,
              cache_creation_input_tokens: 500,
            },
          },
          usageMetadata: {
            promptTokenCount: 5000,
            candidatesTokenCount: 10,
            totalTokenCount: 5010,
            cachedContentTokenCount: 2000,
          },
        };
      }),
    };

    const view = buildTokenSyncView(
      fixture,
      mockProvider,
      'ac12-cached-session',
    );

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(realLogger);

    const promptId = 'ac12-cached-prompt';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 300,
      estimator: 'anthropic-char',
      tiktokenTokens: 280,
    });

    const stream = await chat.sendMessageStream(
      { message: [{ text: 'Tell me about caching' }] },
      promptId,
    );
    for await (const _event of stream) {
      // consume
    }

    await historyService.waitForTokenUpdates();

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
    const record = records[0];

    // AC-3: new cost fields
    expect(record.cache_read_tokens).toBe(2000);
    expect(record.cache_write_tokens).toBe(500);
    expect(record.output_tokens).toBe(10);
    expect(record.total_tokens).toBe(5010);

    // AC-11: legacy fields unchanged
    expect(record.actual_prompt_tokens).toBe(5000);
    expect(record.cached_tokens).toBe(2000);
    expect(record.effective_actual_tokens).toBe(3000);

    // Unreported fields are omitted
    expect('reasoning_tokens' in record).toBe(false);
    expect('tool_tokens' in record).toBe(false);
  });

  // #3257: per-attempt provider timing measured at the agents-layer stream
  // seam. Real ChatSession + real TokenUsageLogger; only the provider
  // transport is a fake whose generator sleeps between token-bearing chunks.
  it('records ttft/generation/provider_request/chunk_count for a timed streaming turn (#3257)', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    const providerOptions: Array<{
      metadata?: Record<string, unknown>;
    }> = [];
    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi
        .fn()
        .mockImplementation(async function* (options: {
          metadata?: Record<string, unknown>;
        }) {
          providerOptions.push(options);
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'The ' }] };
          await Bun.sleep(15);
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'answer ' }] };
          await Bun.sleep(15);
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
      'timing-stream-session',
    );

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(realLogger);

    const promptId = 'timing-stream-prompt';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 150,
      estimator: 'anthropic-char',
      tiktokenTokens: 140,
    });

    const stream = await chat.sendMessageStream(
      { message: [{ text: 'What is 2+2?' }] },
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

    // AC-6: the agents layer threads the caller-visible prompt id through
    // options metadata so the provider-layer recorder can join perf records.
    expect(providerOptions).toHaveLength(1);
    expect(providerOptions[0].metadata?.['__logicalRequestId']).toBe(promptId);
  });

  // #3257: a stream with no token-bearing output has no token window —
  // ttft/generation are omitted while request duration + chunk count remain.
  it('omits ttft/generation for a usage-only stream but keeps provider_request/chunk_count (#3257)', async () => {
    const fixture = createTokenSyncTestFixture();
    const mockContentGenerator = fixture.mockContentGenerator;
    const historyService = fixture.historyService;

    const mockProvider = {
      name: 'anthropic',
      generateChatCompletion: vi.fn().mockImplementation(async function* () {
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            usage: {
              promptTokens: 5000,
              completionTokens: 5,
              totalTokens: 5005,
            },
          },
        };
      }),
    };

    const view = buildTokenSyncView(
      fixture,
      mockProvider,
      'usage-only-session',
    );

    const chat = new ChatSession(view, mockContentGenerator, {}, []);

    const realLogger = new TokenUsageLogger(true, logFile);
    chat.setTokenUsageLoggerForTesting(realLogger);

    const promptId = 'usage-only-prompt';
    realLogger.recordEstimate(promptId, {
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      estimatedTokens: 150,
      estimator: 'anthropic-char',
      tiktokenTokens: 140,
    });

    const stream = await chat.sendMessageStream(
      { message: [{ text: 'What is 2+2?' }] },
      promptId,
    );
    // A usage-only stream fails completion validation (no response text).
    // The turn record is written at stream end before that terminal error,
    // which is the behavior under test here.
    let streamError: unknown;
    try {
      for await (const _event of stream) {
        // consume
      }
    } catch (error) {
      streamError = error;
    }
    expect(streamError).toBeInstanceOf(InvalidStreamError);

    await historyService.waitForTokenUpdates();

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect('ttft_ms' in record).toBe(false);
    expect('generation_ms' in record).toBe(false);
    expect(record.provider_request_ms).toBeGreaterThanOrEqual(0);
    expect(record.chunk_count).toBe(1);
  });

  // #3257 review finding: a failed attempt's partial timing must be
  // attached at the stream-error seam before the error propagates, so the
  // abandoned-attempt record carries measured ttft/provider_request (no
  // generation window from a single token-bearing chunk). The retry's
  // success record must carry its own fresh timing, not attempt 1's.
  it('records partial timing on an abandoned stream attempt and fresh timing on the retry (#3257)', async () => {
    const { attempt, records, abandoned, success } =
      await observeRecordsPartialTimingOnAnAbandonedStreamAttemptAndFreshTimingOn();
    expect(attempt).toBe(2);
    expect(records).toHaveLength(2);
    expect(abandoned).toBeDefined();
    expect(abandoned.attempt_index).toBe(0);
    expect(typeof abandoned.ttft_ms).toBe('number');
    expect(abandoned.ttft_ms).toBeGreaterThanOrEqual(0);
    expect(typeof abandoned.provider_request_ms).toBe('number');
    expect(abandoned.provider_request_ms).toBeGreaterThanOrEqual(0);
    expect('generation_ms' in abandoned).toBe(false);
    expect(abandoned.chunk_count).toBe(1);
    expect(success).toBeDefined();
    expect(success.attempt_index).toBe(1);
    expect(typeof success.ttft_ms).toBe('number');
    expect(success.ttft_ms).toBeGreaterThanOrEqual(0);
    expect(success.generation_ms).toBeGreaterThan(0);
    expect(typeof success.provider_request_ms).toBe('number');
    expect(success.provider_request_ms).toBeGreaterThanOrEqual(0);
    expect(success.chunk_count).toBe(3);
  });

  const observeRecordsPartialTimingOnAnAbandonedStreamAttemptAndFreshTimingOn =
    async () => {
      const fixture = createTokenSyncTestFixture();
      const mockContentGenerator = fixture.mockContentGenerator;
      const historyService = fixture.historyService;

      let attempt = 0;
      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          attempt++;
          if (attempt === 1) {
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
          await Bun.sleep(15);
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'answer ' }] };
          await Bun.sleep(15);
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

      const view = buildTokenSyncView(
        fixture,
        mockProvider,
        'abandoned-timing-session',
      );

      const chat = new ChatSession(view, mockContentGenerator, {}, []);

      const realLogger = new TokenUsageLogger(true, logFile);
      chat.setTokenUsageLoggerForTesting(realLogger);

      const promptId = 'abandoned-timing-prompt';
      realLogger.recordEstimate(promptId, {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        estimatedTokens: 150,
        estimator: 'anthropic-char',
        tiktokenTokens: 140,
      });

      const stream = await chat.sendMessageStream(
        { message: [{ text: 'What is 2+2?' }] },
        promptId,
      );
      for await (const _event of stream) {
        // consume
      }

      await historyService.waitForTokenUpdates();

      const records = readJsonl(logFile);

      const abandoned = records.find((r) => r.attempt_outcome === 'abandoned');

      if (abandoned === undefined) throw new Error('no abandoned record');

      // Single token-bearing chunk: the generation window is not strictly
      // positive, so generation_ms must be omitted.

      const success = records.find((r) => r.attempt_outcome !== 'abandoned');

      if (success === undefined) throw new Error('no success record');

      // Fresh attempt-2 timing wins: three chunks, not attempt 1's single one.

      return { attempt, records, abandoned, success };
    };

  // #3257: EmptyStreamError is thrown outside _convertIContentStream's catch
  // (eager first-chunk pull), so partial timing must attach at that seam too.
  // The unbilled empty attempt writes no record by design; the retry's
  // success record must carry the SECOND attempt's fresh timing.
  it('retries a zero-chunk stream and records fresh timing on the retry (#3257)', async () => {
    const { attempt, records, success } =
      await observeRetriesAZeroChunkStreamAndRecordsFreshTimingOnTheRetry();
    expect(attempt).toBe(2);
    expect(records).toHaveLength(1);
    expect(success.attempt_index).toBe(0);
    expect(success.attempt_outcome).toBe('success');
    expect(success.chunk_count).toBe(2);
    expect(typeof success.ttft_ms).toBe('number');
    expect(success.ttft_ms).toBeGreaterThanOrEqual(0);
    expect(success.generation_ms).toBeGreaterThan(0);
    expect(typeof success.provider_request_ms).toBe('number');
    expect(success.provider_request_ms).toBeGreaterThanOrEqual(0);
  });

  const observeRetriesAZeroChunkStreamAndRecordsFreshTimingOnTheRetry =
    async () => {
      const fixture = createTokenSyncTestFixture();
      const { mockContentGenerator, historyService } = fixture;
      let attempt = 0;
      const mockProvider = {
        name: 'anthropic',
        generateChatCompletion: vi.fn().mockImplementation(async function* () {
          attempt++;
          if (attempt === 1) {
            return; // zero chunks: eager first-chunk pull throws EmptyStreamError
          }
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'Hi ' }] };
          await Bun.sleep(15);
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'there.' }],
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
      const view = buildTokenSyncView(
        fixture,
        mockProvider,
        'empty-stream-session',
      );
      const chat = new ChatSession(view, mockContentGenerator, {}, []);
      const realLogger = new TokenUsageLogger(true, logFile);
      chat.setTokenUsageLoggerForTesting(realLogger);
      const promptId = 'empty-stream-prompt';
      realLogger.recordEstimate(promptId, {
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        estimatedTokens: 150,
        estimator: 'anthropic-char',
        tiktokenTokens: 140,
      });
      const stream = await chat.sendMessageStream(
        { message: [{ text: 'Say hi' }] },
        promptId,
      );
      for await (const _event of stream) {
        // consume
      }
      await historyService.waitForTokenUpdates();

      const records = readJsonl(logFile);

      const success = records[0];
      // The retry happens inside retryWithBackoff, below turn-attempt
      // accounting: the unbilled empty attempt is invisible here.

      return { attempt, records, success };
    };
});
