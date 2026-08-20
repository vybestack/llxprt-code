/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import { parseTokenUsageLogRecord } from './tokenUsageRecords.js';

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-timing-')),
    'usage.jsonl',
  );
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Records an estimate + actual for one prompt after optionally attaching
 * turn-context timing, then returns the single emitted record. Mirrors the
 * production order: estimate at the send seam, timing attached at stream
 * completion, actual recorded at turn end.
 */
async function recordTurnWithTiming(
  logger: TokenUsageLogger,
  promptId: string,
  ...timing: Array<Parameters<TokenUsageLogger['attachTurnContext']>[1]>
): Promise<Record<string, unknown>> {
  logger.recordEstimate(promptId, {
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    estimatedTokens: 100,
    estimator: 'anthropic-char',
    tiktokenTokens: 90,
  });
  for (const context of timing) {
    logger.attachTurnContext(promptId, context);
  }
  await logger.recordActual(promptId, {
    actualPromptTokens: 120,
    cachedTokens: 0,
  });
  const records = readJsonl(logFilePath);
  const record = records.find((r) => r.prompt_id === promptId);
  expect(record).toBeDefined();
  if (record === undefined) throw new Error(`no record for ${promptId}`);
  return record;
}

let logFilePath: string;

function useTempLogFile(): void {
  beforeEach(() => {
    logFilePath = makeTempLogPath();
  });
  afterEach(() => {
    const dir = path.dirname(logFilePath);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      // Temp dir cleanup is best-effort; failure here does not affect outcomes
      process.stderr.write(`Failed to clean up temp dir: ${String(error)}\n`);
    }
  });
}

describe('TokenUsageLogger turn-record timing (issue #3257)', () => {
  useTempLogFile();

  it('serializes attached timing as ttft_ms, generation_ms, provider_request_ms, chunk_count', async () => {
    const logger = new TokenUsageLogger(true, logFilePath);
    const record = await recordTurnWithTiming(logger, 'timing-full', {
      ttftMs: 200,
      lastTokenMs: 1200,
      providerRequestMs: 1500,
      chunkCount: 10,
    });

    expect(record.ttft_ms).toBe(200);
    expect(record.generation_ms).toBe(1000);
    expect(record.provider_request_ms).toBe(1500);
    expect(record.chunk_count).toBe(10);
  });

  it('omits generation_ms when lastTokenMs equals ttftMs (single-instant window)', async () => {
    const logger = new TokenUsageLogger(true, logFilePath);
    const record = await recordTurnWithTiming(logger, 'timing-equal', {
      ttftMs: 300,
      lastTokenMs: 300,
      providerRequestMs: 500,
      chunkCount: 2,
    });

    expect(record.ttft_ms).toBe(300);
    expect('generation_ms' in record).toBe(false);
    expect(record.provider_request_ms).toBe(500);
  });

  it('omits generation_ms when lastTokenMs precedes ttftMs', async () => {
    const logger = new TokenUsageLogger(true, logFilePath);
    const record = await recordTurnWithTiming(logger, 'timing-inverted', {
      ttftMs: 900,
      lastTokenMs: 100,
      providerRequestMs: 1000,
      chunkCount: 1,
    });

    expect(record.ttft_ms).toBe(900);
    expect('generation_ms' in record).toBe(false);
  });

  it('omits generation_ms when only one endpoint of the window is measured', async () => {
    const logger = new TokenUsageLogger(true, logFilePath);
    const noLastToken = await recordTurnWithTiming(logger, 'timing-no-last', {
      ttftMs: 200,
      lastTokenMs: null,
      providerRequestMs: 800,
      chunkCount: 3,
    });
    expect(noLastToken.ttft_ms).toBe(200);
    expect('generation_ms' in noLastToken).toBe(false);

    const noFirstToken = await recordTurnWithTiming(logger, 'timing-no-first', {
      ttftMs: null,
      lastTokenMs: 700,
      providerRequestMs: 900,
      chunkCount: 4,
    });
    expect('ttft_ms' in noFirstToken).toBe(false);
    expect('generation_ms' in noFirstToken).toBe(false);
  });

  it('a later timing attach fully replaces the prior attempt timing (retry overwrite)', async () => {
    const logger = new TokenUsageLogger(true, logFilePath);
    const record = await recordTurnWithTiming(
      logger,
      'timing-retry',
      {
        ttftMs: 200,
        lastTokenMs: 1200,
        providerRequestMs: 1500,
        chunkCount: 10,
      },
      {
        ttftMs: null,
        lastTokenMs: null,
        providerRequestMs: 1600,
        chunkCount: 3,
      },
    );

    // The retry attempt's timing wins; no value from attempt A leaks.
    expect('ttft_ms' in record).toBe(false);
    expect('generation_ms' in record).toBe(false);
    expect(record.provider_request_ms).toBe(1600);
    expect(record.chunk_count).toBe(3);
  });

  it('emits none of the timing fields when no timing was attached', async () => {
    const logger = new TokenUsageLogger(true, logFilePath);
    const record = await recordTurnWithTiming(logger, 'timing-absent');

    expect('ttft_ms' in record).toBe(false);
    expect('generation_ms' in record).toBe(false);
    expect('provider_request_ms' in record).toBe(false);
    expect('chunk_count' in record).toBe(false);
  });

  it('parseTokenUsageLogRecord round-trips timing fields and still parses legacy records', () => {
    const legacyRecord: Record<string, unknown> = {
      record_type: 'turn',
      schema_version: 1,
      ts: '2026-08-20T00:00:00.000Z',
      prompt_id: 'legacy-prompt',
      provider: 'openai',
      model: 'gpt-4',
      estimated_tokens: 100,
      estimator: 'openai-tiktoken',
      tiktoken_tokens: 90,
      tiktoken_estimation_failed: false,
      actual_prompt_tokens: 120,
      cached_tokens: 0,
      effective_actual_tokens: 120,
    };
    const parsedLegacy = parseTokenUsageLogRecord(legacyRecord);
    expect(parsedLegacy).not.toBeNull();
    expect(parsedLegacy?.record_type).toBe('turn');

    const timedRecord = {
      ...legacyRecord,
      prompt_id: 'timed-prompt',
      ttft_ms: 200,
      generation_ms: 1000,
      provider_request_ms: 1500,
      chunk_count: 10,
    };
    const parsedTimed = parseTokenUsageLogRecord(timedRecord);
    expect(parsedTimed).not.toBeNull();
    if (parsedTimed?.record_type !== 'turn') return;
    expect(parsedTimed.ttft_ms).toBe(200);
    expect(parsedTimed.generation_ms).toBe(1000);
    expect(parsedTimed.provider_request_ms).toBe(1500);
    expect(parsedTimed.chunk_count).toBe(10);
  });
});
