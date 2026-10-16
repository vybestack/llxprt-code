/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 slice 5: lifecycle event emission from production code (AC-7).
 *
 * These tests drive a REAL disk compression through the real CompressionHandler
 * and assert that a typed `compression` lifecycle record lands in the same
 * JSONL file alongside turn records. The TokenUsageLogger is real and only the
 * summary provider transport is faked — assertions are on the written file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import {
  TOKEN_USAGE_SCHEMA_VERSION,
  parseTokenUsageLogRecord,
} from './tokenUsageRecords.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  middleoutSetup,
  SummaryTransport,
} from '../compression/__tests__/middleout-disk-helpers.js';
import { collectRows } from '../compression/__tests__/truncation-stream-helpers.js';

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
// Compression test fixture: a real HistoryService with a real conversation, a
// real CompressionHandler running the real disk middle-out compression, and a
// real TokenUsageLogger. The ONLY fake is the summary provider transport (the
// provider boundary): it answers the summary request with a snapshot and
// reports the usage of that call. Token counts, the compression record and the
// JSONL file are all produced by production code.
// ---------------------------------------------------------------------------

const COMPRESSION_MODEL = 'test-model';
const COMPRESSION_PROVIDER = 'summary-transport';
const SESSION_ID = 'test-session';
const SUMMARY_PROMPT_TOKENS = 71;
const SUMMARY_OUTPUT_TOKENS = 9;
const CONVERSATION_TURNS = 40;

function conversationRows(turns: number): IContent[] {
  const rows: IContent[] = [];
  for (let turn = 0; turn < turns; turn++) {
    const filler = `detail-${turn} `.repeat(120);
    rows.push(
      { speaker: 'human', blocks: [{ type: 'text', text: `ask ${filler}` }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: `answer ${filler}` }] },
    );
  }
  return rows;
}

async function buildCompressionHandler(
  logFile: string,
  rows: readonly IContent[] = conversationRows(CONVERSATION_TURNS),
): Promise<{
  handler: ReturnType<typeof middleoutSetup>['handler'];
  transport: SummaryTransport;
  logger: TokenUsageLogger;
  historyService: HistoryService;
}> {
  const historyService = new HistoryService();
  if (rows.length > 0) {
    historyService.addAll(rows);
    await historyService.waitForCommit();
  }
  const { handler, transport } = middleoutSetup(historyService);
  const logger = new TokenUsageLogger(true, logFile);
  handler.tokenUsageLogger = logger;
  return { handler, transport, logger, historyService };
}

interface CompressionObservation {
  readonly result: PerformCompressionResult;
  readonly tokensBefore: number;
  readonly historyService: HistoryService;
  readonly logger: TokenUsageLogger;
}

async function compressConversation(
  promptId: string,
): Promise<CompressionObservation> {
  const { handler, logger, historyService } =
    await buildCompressionHandler(logFile);
  const tokensBefore = historyService.getTotalTokens();
  const result = await handler.performCompression(promptId);
  return { result, tokensBefore, historyService, logger };
}

async function independentTokensAfter(
  historyService: HistoryService,
): Promise<number> {
  return historyService.estimateTokensForContents(
    await collectRows(historyService),
  );
}

const observeEmitsACompressionRecordWhenARealCompressionCompletes =
  async () => {
    const { result, tokensBefore, historyService } = await compressConversation(
      'test-prompt-lifecycle',
    );
    expect(result).toBe(PerformCompressionResult.COMPRESSED);

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    const compressionRecords = records.filter(
      (r) => r.record_type === 'compression',
    );

    const record = compressionRecords[0];

    // AC-12: tokens_after < tokens_before. The record is read back as plain
    // JSON, so narrow the unknown numeric fields before comparing them.
    const tokensAfter = record.tokens_after;
    const recordedBefore = record.tokens_before;
    if (typeof recordedBefore !== 'number' || typeof tokensAfter !== 'number') {
      throw new Error(
        `tokens_before/tokens_after must be numbers (got ${typeof recordedBefore}, ${typeof tokensAfter})`,
      );
    }

    return {
      compressionRecords,
      record,
      tokensAfter,
      tokensBefore: recordedBefore,
      expectedBefore: tokensBefore,
      expectedAfter: await independentTokensAfter(historyService),
    };
  };

const observeTheCompressionRecordRoundTripsThroughParseTokenUsageLogRecord =
  async () => {
    const { tokensBefore, historyService } = await compressConversation(
      'test-prompt-roundtrip',
    );

    const raw = fs.readFileSync(logFile, 'utf-8').trim();
    const parsed = parseTokenUsageLogRecord(JSON.parse(raw));

    if (parsed === null) throw new Error('expected a parseable record');

    if (parsed.record_type !== 'compression')
      throw new Error('expected a compression record');

    return {
      parsed,
      expectedBefore: tokensBefore,
      expectedAfter: await independentTokensAfter(historyService),
    };
  };

async function observeCoexistingRecords(): Promise<{
  lines: string[];
  parsed0: ReturnType<typeof parseTokenUsageLogRecord>;
  parsed1: ReturnType<typeof parseTokenUsageLogRecord>;
}> {
  const { logger } = await compressConversation('test-prompt-coexist');

  // Emit a turn record through the same logger the compression record used
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
  const parsed0 = parseTokenUsageLogRecord(JSON.parse(lines[0]));
  const parsed1 = parseTokenUsageLogRecord(JSON.parse(lines[1]));
  return { lines, parsed0, parsed1 };
}

let logFile: string;
describe('TokenUsageLogger — lifecycle event emission (issue #3130 slice 5)', () => {
  beforeEach(() => {
    logFile = makeTempLogPath();
  });
  afterEach(() => {
    cleanupDir(logFile);
  });

  // -------------------------------------------------------------------------
  // AC-12: Compression turn — end-to-end through the real handler
  // -------------------------------------------------------------------------

  it('emits a compression record when a real compression completes', async () => {
    const {
      compressionRecords,
      record,
      tokensAfter,
      tokensBefore,
      expectedBefore,
      expectedAfter,
    } = await observeEmitsACompressionRecordWhenARealCompressionCompletes();
    expect(compressionRecords).toHaveLength(1);
    expect(record.record_type).toBe('compression');
    expect(record.schema_version).toBe(TOKEN_USAGE_SCHEMA_VERSION);
    expect(record.session_id).toBe(SESSION_ID);
    expect(record.tokens_before).toBe(expectedBefore);
    expect(record.tokens_after).toBe(expectedAfter);
    expect(tokensAfter).toBeLessThan(tokensBefore);
    expect(record.compression_model).toBe(COMPRESSION_MODEL);
    expect(record.compression_provider).toBe(COMPRESSION_PROVIDER);
    expect(record.compression_prompt_tokens).toBe(SUMMARY_PROMPT_TOKENS);
    expect(record.compression_output_tokens).toBe(SUMMARY_OUTPUT_TOKENS);
  });

  it('does not emit a compression record when compression is a structural no-op', async () => {
    const { handler, transport } = await buildCompressionHandler(logFile, [
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      { speaker: 'ai', blocks: [{ type: 'text', text: 'hi' }] },
    ]);

    expect(await handler.performCompression('test-prompt-noop')).toBe(
      PerformCompressionResult.NOOP,
    );

    // The provider was never asked for a summary, and no file was written
    expect(transport.requests).toHaveLength(0);
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('does not emit a compression record when compression is skipped (empty history)', async () => {
    const { handler } = await buildCompressionHandler(logFile, []);

    expect(await handler.performCompression('test-prompt-empty')).toBe(
      PerformCompressionResult.SKIPPED_EMPTY,
    );

    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('emits exactly one compression record per compression call (no duplicates)', async () => {
    await compressConversation('test-prompt-once');

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    const compressionRecords = records.filter(
      (r) => r.record_type === 'compression',
    );
    expect(compressionRecords).toHaveLength(1);
  });

  it('emits a disabled-logger no-op (no file written)', async () => {
    const { handler } = await buildCompressionHandler(logFile);

    // Replace logger with a disabled one
    handler.tokenUsageLogger = new TokenUsageLogger(false, logFile);

    expect(await handler.performCompression('test-prompt-disabled')).toBe(
      PerformCompressionResult.COMPRESSED,
    );

    expect(fs.existsSync(logFile)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Lifecycle records coexist with turn records in one file
  // -------------------------------------------------------------------------

  it('lifecycle records coexist with turn records in one file and parseTokenUsageLogRecord reads both', async () => {
    const { lines, parsed0, parsed1 } = await observeCoexistingRecords();
    expect(lines).toHaveLength(2);

    expect(parsed0?.record_type).toBe('compression');
    expect(parsed1?.record_type).toBe('turn');

    // Both carry the schema version
    expect(parsed0?.schema_version).toBe(TOKEN_USAGE_SCHEMA_VERSION);
    expect(parsed1?.schema_version).toBe(TOKEN_USAGE_SCHEMA_VERSION);
  });

  it('the compression record round-trips through parseTokenUsageLogRecord', async () => {
    const { parsed, expectedBefore, expectedAfter } =
      await observeTheCompressionRecordRoundTripsThroughParseTokenUsageLogRecord();
    expect(parsed).not.toBeNull();
    expect(parsed.record_type).toBe('compression');
    expect(parsed.tokens_before).toBe(expectedBefore);
    expect(parsed.tokens_after).toBe(expectedAfter);
    expect(parsed.compression_model).toBe(COMPRESSION_MODEL);
    expect(parsed.compression_provider).toBe(COMPRESSION_PROVIDER);
  });
});
