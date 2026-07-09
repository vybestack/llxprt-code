/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
    } catch {
      // ignore cleanup errors
    }
  });

  it('writes one JSONL record after recordEstimate + recordActual', () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-1', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 95,
    });
    logger.recordActual('prompt-1', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
  });

  it('record contains all required fields with snake_case keys', () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-2', {
      provider: 'anthropic',
      model: 'claude-3',
      estimatedTokens: 200,
      estimator: 'anthropic-char',
      tiktokenTokens: 180,
    });
    logger.recordActual('prompt-2', {
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
  });

  it('computes effective_actual_tokens = actual - cached', () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-3', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    logger.recordActual('prompt-3', {
      actualPromptTokens: 500,
      cachedTokens: 200,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].effective_actual_tokens).toBe(300);
  });

  it('does not allow effective_actual_tokens to go negative', () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-neg', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    logger.recordActual('prompt-neg', {
      actualPromptTokens: 100,
      cachedTokens: 300,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].effective_actual_tokens).toBe(0);
  });

  it('disabled logger writes nothing', () => {
    const logger = new TokenUsageLogger(false, logFile);
    logger.recordEstimate('prompt-4', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    logger.recordActual('prompt-4', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('recordActual with no pending estimate writes nothing', () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordActual('never-estimated', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('does not persist any prompt text (privacy)', () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-priv', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    logger.recordActual('prompt-priv', {
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

  it('file I/O errors do not crash (fail-open)', () => {
    const badPath = path.join('/nonexistent-dir-xyz', 'sub', 'usage.jsonl');
    const logger = new TokenUsageLogger(true, badPath);
    expect(() => {
      logger.recordEstimate('prompt-fail', {
        provider: 'openai',
        model: 'gpt-4',
        estimatedTokens: 100,
        estimator: 'openai-tiktoken',
        tiktokenTokens: 90,
      });
      logger.recordActual('prompt-fail', {
        actualPromptTokens: 120,
        cachedTokens: 0,
      });
    }).not.toThrow();
    expect(fs.existsSync(badPath)).toBe(false);
  });

  it('clears pending entry after recordActual completes', () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-clear', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    logger.recordActual('prompt-clear', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    logger.recordActual('prompt-clear', {
      actualPromptTokens: 999,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile);
    expect(records).toHaveLength(1);
  });

  it('evicts oldest pending entry when exceeding PENDING_CAP', () => {
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

    logger.recordActual('prompt-0', {
      actualPromptTokens: 10,
      cachedTokens: 0,
    });

    expect(fs.existsSync(logFile)).toBe(false);

    logger.recordActual('prompt-overflow', {
      actualPromptTokens: 999,
      cachedTokens: 0,
    });

    const overflowRecords = readJsonl(logFile) as Array<
      Record<string, unknown>
    >;
    expect(overflowRecords).toHaveLength(1);
    expect(overflowRecords[0].prompt_id).toBe('prompt-overflow');
  });

  it('isEnabled returns the enabled state', () => {
    const enabled = new TokenUsageLogger(true, logFile);
    const disabled = new TokenUsageLogger(false, logFile);
    expect(enabled.isEnabled()).toBe(true);
    expect(disabled.isEnabled()).toBe(false);
  });

  it('creates parent directory if it does not exist', () => {
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
    logger.recordActual('prompt-nested', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    expect(fs.existsSync(nestedPath)).toBe(true);
  });

  it('ts field is a valid ISO date string', () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-ts', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    logger.recordActual('prompt-ts', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    const ts = records[0].ts as string;
    expect(() => new Date(ts).toISOString()).not.toThrow();
    expect(new Date(ts).toString()).not.toBe('Invalid Date');
  });
  it('overwrites pending estimate when recordEstimate is called twice for same promptId', () => {
    const logger = new TokenUsageLogger(true, logFile);
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
    logger.recordActual('prompt-overwrite', {
      actualPromptTokens: 250,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0].estimated_tokens).toBe(200);
    expect(records[0].model).toBe('claude-3');
  });

  it('enabled logger with undefined logFilePath writes nothing and does not crash', () => {
    const logger = new TokenUsageLogger(true, undefined);
    expect(() => {
      logger.recordEstimate('prompt-no-path', {
        provider: 'openai',
        model: 'gpt-4',
        estimatedTokens: 100,
        estimator: 'openai-tiktoken',
        tiktokenTokens: 90,
      });
      logger.recordActual('prompt-no-path', {
        actualPromptTokens: 120,
        cachedTokens: 0,
      });
    }).not.toThrow();
  });
});
