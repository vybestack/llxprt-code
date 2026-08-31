/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 slice 5: lifecycle event emission from production code (AC-7).
 *
 * These tests drive a REAL compression through the real CompressionHandler and
 * assert that a typed `compression` lifecycle record lands in the same JSONL
 * file alongside turn records. The TokenUsageLogger is real — assertions are on
 * the written file, not on mock call shapes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import {
  TOKEN_USAGE_SCHEMA_VERSION,
  parseTokenUsageLogRecord,
} from './tokenUsageRecords.js';
import { CompressionHandler } from '../compression/CompressionHandler.js';
import * as compressionFactory from '../compression/compressionStrategyFactory.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import * as providerRuntime from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionContext,
  StrategyCompressionResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';

// ---------------------------------------------------------------------------
// Temp file helpers
// ---------------------------------------------------------------------------

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-lifecycle-')),
    'usage.jsonl',
  );
}

function readJsonl(filePath: string): unknown[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

function cleanupDir(filePath: string): void {
  try {
    fs.rmSync(path.dirname(filePath), { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Compression test fixture: builds a real CompressionHandler with a real
// TokenUsageLogger. The strategy factory is the ONLY mocked boundary — it
// produces a deterministic compression result. Everything else (the handler,
// the logger, the JSONL file) is real.
// ---------------------------------------------------------------------------

const TOKENS_BEFORE = 100_000;
const TOKENS_AFTER = 3_000;
const COMPRESSION_MODEL = 'gpt-4o-mini';
const COMPRESSION_PROVIDER = 'openai';
const SESSION_ID = 'lifecycle-test-session';

function buildCompressionHandler(logFile: string): {
  handler: CompressionHandler;
  logger: TokenUsageLogger;
} {
  const runtimeSetup = createChatSessionRuntime();
  const providerRuntimeSnapshot: ProviderRuntimeContext = {
    ...runtimeSetup.runtime,
    config: runtimeSetup.config,
  };
  providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);

  const runtimeState = createAgentRuntimeState({
    runtimeId: 'test-lifecycle-runtime',
    provider: COMPRESSION_PROVIDER,
    model: COMPRESSION_MODEL,
    sessionId: SESSION_ID,
  });

  const historyService = new HistoryService();

  // Pre-compression: high token count; post-compression: low token count.
  // The first call returns TOKENS_BEFORE (during buildCompressionContext /
  // tokensBefore capture). After the strategy applies new history, subsequent
  // calls return TOKENS_AFTER.
  let compressed = false;
  vi.spyOn(historyService, 'getTotalTokens').mockImplementation(() =>
    compressed ? TOKENS_AFTER : TOKENS_BEFORE,
  );
  vi.spyOn(historyService, 'waitForTokenUpdates').mockResolvedValue(undefined);
  vi.spyOn(historyService, 'getStatistics').mockReturnValue({
    totalMessages: 10,
    userMessages: 5,
    aiMessages: 5,
    toolCalls: 0,
    toolResponses: 0,
  });
  vi.spyOn(historyService, 'startCompression').mockImplementation(() => {});
  vi.spyOn(historyService, 'endCompression').mockImplementation(() => {});
  const curatedHistory: IContent[] = [
    { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'hi' }] },
  ];
  vi.spyOn(historyService, 'getCurated').mockReturnValue(curatedHistory);
  vi.spyOn(historyService, 'getRawHistory').mockReturnValue(curatedHistory);
  vi.spyOn(historyService, 'estimateTokensForContents').mockImplementation(
    async () => {
      compressed = true;
      return TOKENS_AFTER;
    },
  );
  vi.spyOn(historyService, 'getCacheAnchorSeq').mockReturnValue(0);

  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.5,
      contextLimit: 200_000,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
    },
    provider: createProviderAdapterFromManager(
      runtimeSetup.config.getProviderManager(),
    ),
    telemetry: createTelemetryAdapterFromConfig(runtimeSetup.config),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime: providerRuntimeSnapshot,
  });

  const providerResolver = vi
    .fn<(name: string | undefined) => CompressionProviderResult>()
    .mockReturnValue({
      provider: {
        name: COMPRESSION_PROVIDER,
        getDefaultModel: () => COMPRESSION_MODEL,
      },
      runtime: providerRuntimeSnapshot,
    } as unknown as CompressionProviderResult);

  const hookTrigger = vi.fn<(ctx: CompressionContext) => Promise<void>>();
  hookTrigger.mockResolvedValue(undefined);

  const handler = new CompressionHandler(
    view,
    historyService,
    {},
    providerResolver,
    hookTrigger,
  );

  const logger = new TokenUsageLogger(true, logFile);
  handler.tokenUsageLogger = logger;

  return { handler, logger };
}

/**
 * Install a strategy factory mock that produces a real 'applied' compression
 * result with usage metadata on the summary entry. This is the ONLY mocked
 * boundary — the compression result is a real StrategyCompressionResult.
 */
function installCompressingStrategy(): void {
  vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
    (name: string) => ({
      name: name as 'middle-out',
      requiresLLM: true,
      trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
      compress: vi
        .fn()
        .mockImplementation(
          async (
            context: CompressionContext,
          ): Promise<StrategyCompressionResult> => {
            const summaryEntry: IContent = {
              speaker: 'human',
              blocks: [
                {
                  type: 'text',
                  text: '<state_snapshot>compressed</state_snapshot>',
                },
              ],
              metadata: {
                isSummary: true,
                synthetic: true,
                reason: 'compression-state-snapshot',
                model: COMPRESSION_MODEL,
                usage: {
                  promptTokens: 8000,
                  completionTokens: 500,
                  totalTokens: 8500,
                },
              },
            };
            return {
              kind: 'applied',
              newHistory: [summaryEntry, ...context.history.slice(-2)],
              metadata: {
                originalMessageCount: context.history.length,
                compressedMessageCount: 3,
                strategyUsed: 'middle-out',
                llmCallMade: true,
                topPreserved: 0,
                bottomPreserved: 2,
                middleCompressed: context.history.length - 2,
                usage: {
                  promptTokens: 8000,
                  completionTokens: 500,
                  totalTokens: 8500,
                },
              },
            };
          },
        ),
    }),
  );
}

describe('TokenUsageLogger — lifecycle event emission (issue #3130 slice 5)', () => {
  let logFile: string;

  beforeEach(() => {
    logFile = makeTempLogPath();
  });

  afterEach(() => {
    cleanupDir(logFile);
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // AC-12: Compression turn — end-to-end through the real handler
  // -------------------------------------------------------------------------

  it('emits a compression record when a real compression completes', async () => {
    const { compressionRecords, record, tokensAfter, tokensBefore } =
      await observeEmitsACompressionRecordWhenARealCompressionCompletes();
    expect(compressionRecords).toHaveLength(1);
    expect(record.record_type).toBe('compression');
    expect(record.schema_version).toBe(TOKEN_USAGE_SCHEMA_VERSION);
    expect(record.session_id).toBe(SESSION_ID);
    expect(record.tokens_before).toBe(TOKENS_BEFORE);
    expect(record.tokens_after).toBe(TOKENS_AFTER);
    expect(tokensAfter).toBeLessThan(tokensBefore);
    expect(record.compression_model).toBe(COMPRESSION_MODEL);
    expect(record.compression_provider).toBe(COMPRESSION_PROVIDER);
    expect(record.compression_prompt_tokens).toBe(8000);
    expect(record.compression_output_tokens).toBe(500);
  });

  const observeEmitsACompressionRecordWhenARealCompressionCompletes =
    async () => {
      installCompressingStrategy();
      const { handler } = buildCompressionHandler(logFile);

      await handler.performCompression('test-prompt-lifecycle');

      const records = readJsonl(logFile) as Array<Record<string, unknown>>;
      const compressionRecords = records.filter(
        (r) => r.record_type === 'compression',
      );

      const record = compressionRecords[0];

      // AC-12: tokens_after < tokens_before. The record is read back as plain
      // JSON, so narrow the unknown numeric fields before comparing them.
      const tokensBefore = record.tokens_before;
      const tokensAfter = record.tokens_after;
      if (typeof tokensBefore !== 'number' || typeof tokensAfter !== 'number') {
        throw new Error(
          `tokens_before/tokens_after must be numbers (got ${typeof tokensBefore}, ${typeof tokensAfter})`,
        );
      }

      // The compression model is carried

      // The compression call's own usage

      return { compressionRecords, record, tokensAfter, tokensBefore };
    };

  it('does not emit a compression record when compression is a structural no-op', async () => {
    vi.spyOn(compressionFactory, 'getCompressionStrategy').mockImplementation(
      (name: string) => ({
        name: name as 'middle-out',
        requiresLLM: true,
        trigger: { mode: 'threshold' as const, defaultThreshold: 0.8 },
        compress: vi.fn().mockImplementation(
          async (): Promise<StrategyCompressionResult> => ({
            kind: 'noop',
            reason: 'too-few-compressible',
            metadata: {
              originalMessageCount: 2,
              compressedMessageCount: 2,
              strategyUsed: 'middle-out',
              llmCallMade: false,
            },
          }),
        ),
      }),
    );
    const { handler } = buildCompressionHandler(logFile);

    await handler.performCompression('test-prompt-noop');

    // No file written at all
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('does not emit a compression record when compression is skipped (empty history)', async () => {
    const { handler } = buildCompressionHandler(logFile);

    // Override getCurated to return empty history
    const historyService = (
      handler as unknown as {
        historyService: { getCurated: () => IContent[] };
      }
    ).historyService;
    vi.spyOn(historyService, 'getCurated').mockReturnValue([]);

    await handler.performCompression('test-prompt-empty');

    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('emits exactly one compression record per compression call (no duplicates)', async () => {
    installCompressingStrategy();
    const { handler } = buildCompressionHandler(logFile);

    await handler.performCompression('test-prompt-once');

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    const compressionRecords = records.filter(
      (r) => r.record_type === 'compression',
    );
    expect(compressionRecords).toHaveLength(1);
  });

  it('emits a disabled-logger no-op (no file written)', async () => {
    installCompressingStrategy();
    const { handler } = buildCompressionHandler(logFile);

    // Replace logger with a disabled one
    handler.tokenUsageLogger = new TokenUsageLogger(false, logFile);

    await handler.performCompression('test-prompt-disabled');

    expect(fs.existsSync(logFile)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Lifecycle records coexist with turn records in one file
  // -------------------------------------------------------------------------

  it('lifecycle records coexist with turn records in one file and parseTokenUsageLogRecord reads both', async () => {
    installCompressingStrategy();
    const { handler, logger } = buildCompressionHandler(logFile);

    // Emit a compression lifecycle record through the real handler
    await handler.performCompression('test-prompt-coexist');

    // Emit a turn record through the same logger
    logger.recordEstimate('test-prompt-coexist', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('test-prompt-coexist', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const raw = fs.readFileSync(logFile, 'utf-8').trim();
    const lines = raw.split('\n');
    expect(lines).toHaveLength(2);

    const parsed0 = parseTokenUsageLogRecord(JSON.parse(lines[0]));
    const parsed1 = parseTokenUsageLogRecord(JSON.parse(lines[1]));

    expect(parsed0?.record_type).toBe('compression');
    expect(parsed1?.record_type).toBe('turn');

    // Both carry the schema version
    expect(parsed0?.schema_version).toBe(TOKEN_USAGE_SCHEMA_VERSION);
    expect(parsed1?.schema_version).toBe(TOKEN_USAGE_SCHEMA_VERSION);
  });

  it('the compression record round-trips through parseTokenUsageLogRecord', async () => {
    const { parsed } =
      await observeTheCompressionRecordRoundTripsThroughParseTokenUsageLogRecord();
    expect(parsed).not.toBeNull();
    expect(parsed.record_type).toBe('compression');
    expect(parsed.tokens_before).toBe(TOKENS_BEFORE);
    expect(parsed.tokens_after).toBe(TOKENS_AFTER);
    expect(parsed.compression_model).toBe(COMPRESSION_MODEL);
    expect(parsed.compression_provider).toBe(COMPRESSION_PROVIDER);
  });

  const observeTheCompressionRecordRoundTripsThroughParseTokenUsageLogRecord =
    async () => {
      installCompressingStrategy();
      const { handler } = buildCompressionHandler(logFile);

      await handler.performCompression('test-prompt-roundtrip');

      const raw = fs.readFileSync(logFile, 'utf-8').trim();
      const parsed = parseTokenUsageLogRecord(JSON.parse(raw));

      if (parsed === null) throw new Error('expected a parseable record');

      if (parsed.record_type !== 'compression')
        throw new Error('expected a compression record');

      return { parsed };
    };
});
