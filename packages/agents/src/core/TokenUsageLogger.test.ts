/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TokenUsageLogger, PENDING_CAP } from './TokenUsageLogger.js';

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-')),
    'usage.jsonl',
  );
}

function readJsonl(filePath: string): unknown[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

describe('TokenUsageLogger', () => {
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
      process.stderr.write(`Failed to clean up temp dir: ${String(error)}
`);
    }
  });

  it('writes one JSONL record after recordEstimate + recordActual', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-1', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 95,
    });
    await logger.recordActual('prompt-1', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
  });

  it('record contains all required fields with snake_case keys', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-2', {
      provider: 'anthropic',
      model: 'claude-3',
      estimatedTokens: 200,
      estimator: 'anthropic-char',
      tiktokenTokens: 180,
    });
    await logger.recordActual('prompt-2', {
      actualPromptTokens: 250,
      cachedTokens: 50,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record).toHaveProperty('ts');
    expect(record).toHaveProperty('prompt_id', 'prompt-2');
    expect(record).toHaveProperty('provider', 'anthropic');
    expect(record).toHaveProperty('model', 'claude-3');
    expect(record).toHaveProperty('estimated_tokens', 200);
    expect(record).toHaveProperty('estimator', 'anthropic-char');
    expect(record).toHaveProperty('tiktoken_tokens', 180);
    expect(record).toHaveProperty('actual_prompt_tokens', 250);
    expect(record).toHaveProperty('cached_tokens', 50);
    expect(record).toHaveProperty('effective_actual_tokens');
    expect(record).toHaveProperty('tiktoken_estimation_failed', false);
  });

  it('computes effective_actual_tokens = actual - cached', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-3', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-3', {
      actualPromptTokens: 500,
      cachedTokens: 200,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].effective_actual_tokens).toBe(300);
  });

  it('does not allow effective_actual_tokens to go negative', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-neg', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-neg', {
      actualPromptTokens: 100,
      cachedTokens: 300,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].effective_actual_tokens).toBe(0);
  });

  it('disabled logger writes nothing', async () => {
    const logger = new TokenUsageLogger(false, logFile);
    logger.recordEstimate('prompt-4', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-4', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('recordActual with no pending estimate writes nothing', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await logger.recordActual('never-estimated', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('does not persist any prompt text (privacy)', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-priv', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-priv', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const raw = fs.readFileSync(logFile, 'utf-8');
    const record = JSON.parse(raw.trim()) as Record<string, unknown>;
    const allowedStringFields = new Set([
      'ts',
      'prompt_id',
      'provider',
      'model',
      'estimator',
      'record_type',
    ]);
    const forbiddenTextKeys = [
      'text',
      'prompt',
      'content',
      'message',
      'prompt_text',
    ];
    const recordKeys = Object.keys(record);
    expect(recordKeys.every((key) => !forbiddenTextKeys.includes(key))).toBe(
      true,
    );
    const stringKeys = recordKeys.filter(
      (key) => typeof record[key] === 'string',
    );
    expect(stringKeys.every((key) => allowedStringFields.has(key))).toBe(true);
  });

  it('file I/O errors do not crash (fail-open)', async () => {
    const badPath = path.join(os.tmpdir(), 'invalid\0dir', 'usage.jsonl');
    const logger = new TokenUsageLogger(true, badPath);
    logger.recordEstimate('prompt-fail', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });

    await expect(
      logger.recordActual('prompt-fail', {
        actualPromptTokens: 120,
        cachedTokens: 0,
      }),
    ).resolves.toBeUndefined();
    expect(fs.existsSync(badPath)).toBe(false);
  });

  it('clears pending entry after recordActual completes', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-clear', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-clear', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    await logger.recordActual('prompt-clear', {
      actualPromptTokens: 999,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
  });

  it('evicts oldest pending entry when exceeding PENDING_CAP', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    for (let i = 0; i < PENDING_CAP; i++) {
      logger.recordEstimate(`prompt-${i}`, {
        provider: 'openai',
        model: 'gpt-4',
        estimatedTokens: i,
        estimator: 'openai-tiktoken',
        tiktokenTokens: i,
      });
    }

    logger.recordEstimate('prompt-overflow', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 999,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 999,
    });

    await logger.recordActual('prompt-0', {
      actualPromptTokens: 10,
      cachedTokens: 0,
    });

    expect(fs.existsSync(logFile)).toBe(false);

    await logger.recordActual('prompt-overflow', {
      actualPromptTokens: 999,
      cachedTokens: 0,
    });
    await logger.recordActual('prompt-50', {
      actualPromptTokens: 500,
      cachedTokens: 0,
    });

    const overflowRecords = readJsonl(logFile) as Array<
      Record<string, unknown>
    >;
    expect(overflowRecords).toHaveLength(2);
    expect(overflowRecords.map((record) => record.prompt_id)).toStrictEqual([
      'prompt-overflow',
      'prompt-50',
    ]);
  });

  it('isEnabled returns the enabled state', async () => {
    const enabled = new TokenUsageLogger(true, logFile);
    const disabled = new TokenUsageLogger(false, logFile);
    expect(enabled.isEnabled()).toBe(true);
    expect(disabled.isEnabled()).toBe(false);
  });

  it('creates parent directory if it does not exist', async () => {
    const nestedPath = path.join(
      path.dirname(logFile),
      'nested',
      'deep',
      'usage.jsonl',
    );
    const logger = new TokenUsageLogger(true, nestedPath);
    logger.recordEstimate('prompt-nested', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-nested', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it('ts field is a valid ISO date string', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-ts', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-ts', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    const ts = records[0].ts as string;
    expect(() => new Date(ts).toISOString()).not.toThrow();
    expect(new Date(ts).toString()).not.toBe('Invalid Date');
  });
  it('overwrites a pending estimate at capacity without evicting another prompt', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    for (let i = 0; i < PENDING_CAP - 1; i++) {
      logger.recordEstimate(`filler-${i}`, {
        provider: 'openai',
        model: 'gpt-4',
        estimatedTokens: i,
        estimator: 'openai-tiktoken',
        tiktokenTokens: i,
      });
    }
    logger.recordEstimate('prompt-overwrite', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    logger.recordEstimate('prompt-overwrite', {
      provider: 'anthropic',
      model: 'claude-3',
      estimatedTokens: 200,
      estimator: 'anthropic-char',
      tiktokenTokens: 180,
    });
    await logger.recordActual('prompt-overwrite', {
      actualPromptTokens: 250,
      cachedTokens: 0,
    });
    await logger.recordActual('filler-0', {
      actualPromptTokens: 10,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(2);
    expect(records[0].estimated_tokens).toBe(200);
    expect(records[0].model).toBe('claude-3');
    expect(records[1].prompt_id).toBe('filler-0');
  });

  it('enabled logger with undefined logFilePath writes nothing and does not crash', async () => {
    const logger = new TokenUsageLogger(true, undefined);
    logger.recordEstimate('prompt-no-path', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });

    await expect(
      logger.recordActual('prompt-no-path', {
        actualPromptTokens: 120,
        cachedTokens: 0,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('refineEstimate (finding #8)', () => {
  let logFile: string;

  beforeEach(() => {
    logFile = makeTempLogPath();
  });

  afterEach(() => {
    const dir = path.dirname(logFile);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it('updates the estimate for an existing record, preserving the tiktoken baseline', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-refine', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 95,
    });
    logger.refineEstimate('prompt-refine', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 150,
      estimator: 'openai-tiktoken',
    });
    await logger.recordActual('prompt-refine', {
      actualPromptTokens: 160,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0].estimated_tokens).toBe(150);
    expect(records[0].tiktoken_tokens).toBe(95);
  });

  it('records the estimate with a null tiktoken baseline when no earlier record exists', async () => {
    const logger = new TokenUsageLogger(true, logFile);

    // The finalized envelope is the authoritative estimate for the send, so it
    // is still recorded when no earlier tiktoken measurement was taken. The
    // null baseline states that no comparison was measured for this prompt.
    logger.refineEstimate('prompt-missing', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 150,
      estimator: 'openai-tiktoken',
    });

    await logger.recordActual('prompt-missing', {
      actualPromptTokens: 160,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0].estimated_tokens).toBe(150);
    expect(records[0].tiktoken_tokens).toBeNull();
    expect(records[0].tiktoken_estimation_failed).toBe(false);
  });

  it('is a no-op when disabled', async () => {
    const logger = new TokenUsageLogger(false, logFile);

    logger.refineEstimate('prompt-disabled', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 150,
      estimator: 'openai-tiktoken',
    });

    expect(fs.existsSync(logFile)).toBe(false);
  });
});
