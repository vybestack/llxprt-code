/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: a refused attempt is its own token-usage record. It carries the
 * finish reasons, keeps the prompt's pending state alive for a retry, and a
 * terminal stop finalizes that state. Assertions read the JSONL actually
 * written by a real TokenUsageLogger.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { TokenUsageLogger } from './TokenUsageLogger.js';
import {
  parseTokenUsageLogRecord,
  type TokenUsageActualInput,
} from './tokenUsageRecords.js';
import { usageStatsToActualInput } from './tokenUsageActualLogger.js';

function readJsonl(filePath: string): Array<Record<string, unknown>> {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const REFUSED: TokenUsageActualInput = {
  actualPromptTokens: 120,
  cachedTokens: 0,
  outputTokens: 0,
  attemptIndex: 0,
  attemptOutcome: 'refusal',
  finishReason: 'refusal',
  rawStopReason: 'refusal',
};

describe('TokenUsageLogger refusal records (issue #4036)', () => {
  let logFile: string;
  let logger: TokenUsageLogger;

  beforeEach(() => {
    logFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-refusal-')),
      'usage.jsonl',
    );
    logger = new TokenUsageLogger('debug', logFile);
    logger.recordEstimate('prompt-1', {
      provider: 'claudecode',
      model: 'claude-opus-5-5',
      estimatedTokens: 100,
      estimator: 'anthropic-char',
      tiktokenTokens: null,
    });
  });

  afterEach(() => {
    fs.rmSync(path.dirname(logFile), { recursive: true, force: true });
  });

  it('keeps refusal diagnosis and request lineage in the default summary record', async () => {
    const summaryLogger = new TokenUsageLogger('summary', logFile);
    summaryLogger.recordEstimate('prompt-1', {
      provider: 'claudecode',
      model: 'claude-opus-5-5',
      estimatedTokens: 100,
      estimator: 'anthropic-char',
      tiktokenTokens: null,
    });
    await summaryLogger.recordActual('prompt-1', {
      ...REFUSED,
      refusalCategory: 'policy',
      refusalExplanation: 'The request was blocked by policy.',
      recommendedModel: 'claude-sonnet-5',
      requestId: 'req-refused-1',
      dumpBaseId: 'dump-refused-1',
    });
    await summaryLogger.recordActual('prompt-1', {
      actualPromptTokens: 125,
      cachedTokens: 0,
      outputTokens: 402,
      attemptIndex: 1,
      attemptOutcome: 'success',
      requestId: 'req-accepted-1',
      dumpBaseId: 'dump-accepted-1',
    });
    summaryLogger.recordEstimate('prompt-2', {
      provider: 'claudecode',
      model: 'claude-opus-5-5',
      estimatedTokens: 90,
      estimator: 'anthropic-char',
      tiktokenTokens: null,
    });
    await summaryLogger.recordActual('prompt-2', {
      actualPromptTokens: 90,
      cachedTokens: 0,
      outputTokens: 25,
      attemptIndex: 0,
      attemptOutcome: 'success',
      requestId: 'req-ordinary-1',
    });

    const records = readJsonl(logFile);
    expect(records).toHaveLength(3);
    expect(records[2]).toMatchObject({
      prompt_id: 'prompt-2',
      attempt_outcome: 'success',
    });
    expect(records[0]).toMatchObject({
      record_type: 'turn',
      attempt_outcome: 'refusal',
      refusal_category: 'policy',
      refusal_explanation: 'The request was blocked by policy.',
      recommended_model: 'claude-sonnet-5',
      request_id: 'req-refused-1',
      dump_base_id: 'dump-refused-1',
    });
    expect(records[1]).toMatchObject({
      attempt_outcome: 'success',
      request_id: 'req-accepted-1',
      dump_base_id: 'dump-accepted-1',
    });
    expect(records[2]).not.toHaveProperty('request_id');
    expect(records[0]).not.toHaveProperty('tool_calls');

    expect(records[0]).not.toHaveProperty('instructions_tokens');
  });

  it('keeps an unknown request id as null on a default summary refusal', async () => {
    const summaryLogger = new TokenUsageLogger('summary', logFile);
    summaryLogger.recordEstimate('prompt-1', {
      provider: 'claudecode',
      model: 'claude-opus-5-5',
      estimatedTokens: 100,
      estimator: 'anthropic-char',
      tiktokenTokens: null,
    });
    await summaryLogger.recordActual('prompt-1', {
      ...REFUSED,
      requestId: null,
    });

    expect(readJsonl(logFile)[0]).toHaveProperty('request_id', null);
  });

  it('writes the refusal outcome with finish_reason and raw_stop_reason', async () => {
    await logger.recordActual('prompt-1', REFUSED);

    expect(readJsonl(logFile)[0]).toMatchObject({
      record_type: 'turn',
      attempt_index: 0,
      attempt_outcome: 'refusal',
      finish_reason: 'refusal',
      raw_stop_reason: 'refusal',
      output_tokens: 0,
    });
  });

  it('writes a record that the tolerant reader accepts', async () => {
    await logger.recordActual('prompt-1', REFUSED);

    expect(parseTokenUsageLogRecord(readJsonl(logFile)[0])).not.toBeNull();
  });

  it('logs a later attempt for the same prompt as its own record', async () => {
    await logger.recordActual('prompt-1', REFUSED);
    await logger.recordActual('prompt-1', {
      actualPromptTokens: 125,
      cachedTokens: 0,
      outputTokens: 402,
      attemptIndex: 1,
      attemptOutcome: 'success',
      finishReason: 'stop',
    });

    const records = readJsonl(logFile);
    expect(
      records.map((r) => [r.attempt_index, r.attempt_outcome]),
    ).toStrictEqual([
      [0, 'refusal'],
      [1, 'success'],
    ]);
  });

  it('records the refused attempt only once', async () => {
    await logger.recordActual('prompt-1', REFUSED);
    await logger.recordActual('prompt-1', REFUSED);

    expect(readJsonl(logFile)).toHaveLength(1);
  });

  it('stops accepting attempts for a prompt once it is finalized', async () => {
    await logger.recordActual('prompt-1', REFUSED);
    logger.finalizePrompt('prompt-1');
    await logger.recordActual('prompt-1', {
      actualPromptTokens: 125,
      cachedTokens: 0,
      attemptIndex: 1,
      attemptOutcome: 'success',
    });

    expect(readJsonl(logFile)).toHaveLength(1);
  });

  it('leaves records without finish fields readable and unchanged', async () => {
    await logger.recordActual('prompt-1', {
      actualPromptTokens: 120,
      cachedTokens: 0,
      attemptIndex: 0,
      attemptOutcome: 'success',
    });

    const record = readJsonl(logFile)[0];
    expect(record).not.toHaveProperty('finish_reason');
    expect(record).not.toHaveProperty('raw_stop_reason');
    expect(parseTokenUsageLogRecord(record)).not.toBeNull();
  });
});

describe('usageStatsToActualInput finish reasons (issue #4036)', () => {
  it('carries the finish reasons of the attempt', () => {
    const input = usageStatsToActualInput(
      { promptTokens: 120, completionTokens: 0, totalTokens: 120 },
      {
        attemptIndex: 0,
        attemptOutcome: 'refusal',
        finishReason: 'refusal',
        rawStopReason: 'refusal',
      },
    );

    expect(input).toMatchObject({
      attemptOutcome: 'refusal',
      finishReason: 'refusal',
      rawStopReason: 'refusal',
    });
  });
});
