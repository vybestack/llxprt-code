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
