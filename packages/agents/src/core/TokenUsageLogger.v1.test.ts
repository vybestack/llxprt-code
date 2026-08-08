/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3130 slice 1: versioned record schema + TokenUsageLogger extension.
 *
 * These tests exercise the schema-version stamping, attachTurnContext,
 * widened recordActual (cost + attempt fields), and recordLifecycleEvent
 * added in slice 1. They assert on the actual JSONL written to a temp file.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { TokenUsageLogger, PENDING_CAP } from './TokenUsageLogger.js';
import {
  TOKEN_USAGE_SCHEMA_VERSION,
  parseTokenUsageLogRecord,
  type TokenUsageTurnContext,
  type TokenUsageLifecycleEvent,
} from './tokenUsageRecords.js';

function makeTempLogPath(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'token-usage-v1-')),
    'usage.jsonl',
  );
}

function readJsonl(filePath: string): unknown[] {
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (raw.length === 0) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

describe('TokenUsageLogger — schema versioning (issue #3130 slice 1)', () => {
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

  it('stamps every turn record with schema_version and record_type', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-sv', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-sv', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0].record_type).toBe('turn');
    expect(records[0].schema_version).toBe(TOKEN_USAGE_SCHEMA_VERSION);
  });

  it('pins the existing 17 estimator/calibration field names exactly', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-pin', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      estimatorMethod: 'calibrated',
      estimatorFamily: 'gpt-4',
      estimatorVersion: 'v1',
      assetRevision: 'rev-1',
      projectionRevision: 2,
      protocol: 'openai-chat',
      tiktokenTokens: 95,
      tiktokenEstimationFailed: false,
    });
    await logger.recordActual('prompt-pin', {
      actualPromptTokens: 120,
      cachedTokens: 10,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    const record = records[0];
    const expectedKeys = [
      'ts',
      'prompt_id',
      'provider',
      'model',
      'protocol',
      'estimated_tokens',
      'estimator',
      'estimator_method',
      'estimator_family',
      'estimator_version',
      'asset_revision',
      'projection_revision',
      'tiktoken_tokens',
      'tiktoken_estimation_failed',
      'actual_prompt_tokens',
      'cached_tokens',
      'effective_actual_tokens',
    ];
    for (const key of expectedKeys) {
      expect(record).toHaveProperty(key);
    }
    expect(record.estimated_tokens).toBe(100);
    expect(record.estimator).toBe('openai-tiktoken');
    expect(record.estimator_method).toBe('calibrated');
    expect(record.tiktoken_tokens).toBe(95);
    expect(record.actual_prompt_tokens).toBe(120);
    expect(record.cached_tokens).toBe(10);
    expect(record.effective_actual_tokens).toBe(110);
  });

  it('omits optional estimator fields when undefined', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-omit', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-omit', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0]).not.toHaveProperty('estimator_method');
    expect(records[0]).not.toHaveProperty('estimator_family');
    expect(records[0]).not.toHaveProperty('protocol');
  });

  it('does not write prompt text, tool arguments, or tool result bodies', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.attachTurnContext('prompt-priv2', {
      sessionId: 'sess-secret-SENTINEL_TEXT',
    });
    logger.recordEstimate('prompt-priv2', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-priv2', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const raw = fs.readFileSync(logFile, 'utf-8');
    expect(raw).toContain('SENTINEL_TEXT');
    const record = JSON.parse(raw.trim()) as Record<string, unknown>;
    const textLikeKeys = [
      'text',
      'prompt',
      'content',
      'message',
      'args',
      'arguments',
      'body',
      'output_body',
    ];
    for (const key of textLikeKeys) {
      expect(record).not.toHaveProperty(key);
    }
  });
});

describe('TokenUsageLogger — attachTurnContext', () => {
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

  it('merges turn context into the written turn record', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-ctx', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    const ctx: TokenUsageTurnContext = {
      sessionId: 'sess-1',
      turnId: 'turn-1',
      runtimeId: 'rt-1',
      parentRuntimeId: null,
      subagentName: null,
      instructionsTokens: 200,
      historyTokens: 500,
    };
    logger.attachTurnContext('prompt-ctx', ctx);
    await logger.recordActual('prompt-ctx', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0].session_id).toBe('sess-1');
    expect(records[0].turn_id).toBe('turn-1');
    expect(records[0].runtime_id).toBe('rt-1');
    expect(records[0].parent_runtime_id).toBeNull();
    expect(records[0].subagent_name).toBeNull();
    expect(records[0].instructions_tokens).toBe(200);
    expect(records[0].history_tokens).toBe(500);
  });

  it('retains context attached before the estimate arrives', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.attachTurnContext('prompt-early', {
      sessionId: 'sess-early',
      turnId: 'turn-early',
    });
    logger.recordEstimate('prompt-early', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-early', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0].session_id).toBe('sess-early');
    expect(records[0].turn_id).toBe('turn-early');
  });

  it('serialises tool-call attribution with snake_case keys', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-tools', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    logger.attachTurnContext('prompt-tools', {
      toolCalls: [
        {
          callId: 'call-1',
          toolName: 'read_file',
          resultTokens: 42,
          wasTruncated: false,
        },
        {
          callId: 'call-2',
          toolName: 'write_file',
          resultTokens: 10,
          wasTruncated: true,
        },
      ],
      newToolResultTokens: 52,
      carriedToolResultTokens: 100,
    });
    await logger.recordActual('prompt-tools', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    const toolCalls = records[0].tool_calls as Array<Record<string, unknown>>;
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0]).toStrictEqual({
      call_id: 'call-1',
      tool_name: 'read_file',
      result_tokens: 42,
      was_truncated: false,
    });
    expect(records[0].new_tool_result_tokens).toBe(52);
    expect(records[0].carried_tool_result_tokens).toBe(100);
  });

  it('is a no-op when disabled', () => {
    const logger = new TokenUsageLogger(false, logFile);
    logger.attachTurnContext('prompt-disabled-ctx', { sessionId: 'sess-x' });
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('eviction bound still holds: attachTurnContext entries are capped at PENDING_CAP', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    for (let i = 0; i < PENDING_CAP; i++) {
      logger.attachTurnContext(`ctx-prompt-${i}`, {
        sessionId: `sess-${i}`,
      });
    }
    logger.attachTurnContext('ctx-overflow', {
      sessionId: 'sess-overflow',
    });

    logger.recordEstimate('ctx-prompt-0', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 1,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 1,
    });
    await logger.recordActual('ctx-prompt-0', {
      actualPromptTokens: 10,
      cachedTokens: 0,
    });

    logger.recordEstimate('ctx-overflow', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 2,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 2,
    });
    await logger.recordActual('ctx-overflow', {
      actualPromptTokens: 20,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(2);
    const evictedRecord = records.find((r) => r.prompt_id === 'ctx-prompt-0');
    expect(evictedRecord).toBeDefined();
    expect(evictedRecord).not.toHaveProperty('session_id');
    const overflowRecord = records.find((r) => r.prompt_id === 'ctx-overflow');
    expect(overflowRecord).toBeDefined();
    expect(overflowRecord.session_id).toBe('sess-overflow');
  });
});

describe('TokenUsageLogger — widened recordActual (cost + attempt fields)', () => {
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

  it('passes cost fields through to the JSONL record', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-cost', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-cost', {
      actualPromptTokens: 120,
      cachedTokens: 10,
      outputTokens: 50,
      reasoningTokens: 5,
      cacheWriteTokens: 20,
      cacheReadTokens: 10,
      toolTokens: 8,
      totalTokens: 198,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].output_tokens).toBe(50);
    expect(records[0].reasoning_tokens).toBe(5);
    expect(records[0].cache_write_tokens).toBe(20);
    expect(records[0].cache_read_tokens).toBe(10);
    expect(records[0].tool_tokens).toBe(8);
    expect(records[0].total_tokens).toBe(198);
  });

  it('passes attempt fields through to the JSONL record', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-attempt', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-attempt', {
      actualPromptTokens: 120,
      cachedTokens: 0,
      attemptIndex: 1,
      attemptOutcome: 'error',
      retryReason: 'rate_limit',
      httpStatus: 429,
      backendProfile: 'gpt-4o-mini',
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].attempt_index).toBe(1);
    expect(records[0].attempt_outcome).toBe('error');
    expect(records[0].retry_reason).toBe('rate_limit');
    expect(records[0].http_status).toBe(429);
    expect(records[0].backend_profile).toBe('gpt-4o-mini');
  });

  it('omits cost/attempt fields when not provided (no zero-fill)', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-no-cost', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-no-cost', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0]).not.toHaveProperty('output_tokens');
    expect(records[0]).not.toHaveProperty('total_tokens');
    expect(records[0]).not.toHaveProperty('attempt_index');
    expect(records[0]).not.toHaveProperty('attempt_outcome');
  });

  it('keeps the legacy cached_tokens field alongside cache_read_tokens', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    logger.recordEstimate('prompt-cache', {
      provider: 'anthropic',
      model: 'claude-3',
      estimatedTokens: 200,
      estimator: 'anthropic-char',
      tiktokenTokens: 180,
    });
    await logger.recordActual('prompt-cache', {
      actualPromptTokens: 500,
      cachedTokens: 200,
      cacheReadTokens: 200,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].cached_tokens).toBe(200);
    expect(records[0].cache_read_tokens).toBe(200);
  });
});

describe('TokenUsageLogger — recordLifecycleEvent', () => {
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

  it('writes a compression record to the same JSONL file', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await logger.recordLifecycleEvent({
      type: 'compression',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      tokensBefore: 10000,
      tokensAfter: 3000,
      compressionModel: 'gpt-4o-mini',
      compressionProvider: 'openai',
      compressionPromptTokens: 9000,
      compressionOutputTokens: 500,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.record_type).toBe('compression');
    expect(record.schema_version).toBe(TOKEN_USAGE_SCHEMA_VERSION);
    expect(record.session_id).toBe('sess-1');
    expect(record.turn_id).toBe('turn-1');
    expect(record.tokens_before).toBe(10000);
    expect(record.tokens_after).toBe(3000);
    expect(record.compression_model).toBe('gpt-4o-mini');
    expect(record.compression_provider).toBe('openai');
    expect(record.compression_prompt_tokens).toBe(9000);
    expect(record.compression_output_tokens).toBe(500);
  });

  it('writes a provider_switch record', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await logger.recordLifecycleEvent({
      type: 'provider_switch',
      sessionId: 'sess-1',
      turnId: 'turn-2',
      fromProvider: 'openai',
      toProvider: 'anthropic',
      fromModel: 'gpt-4',
      toModel: 'claude-3',
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].record_type).toBe('provider_switch');
    expect(records[0].from_provider).toBe('openai');
    expect(records[0].to_provider).toBe('anthropic');
  });

  it('writes a model_switch record', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await logger.recordLifecycleEvent({
      type: 'model_switch',
      sessionId: 'sess-1',
      turnId: null,
      fromModel: 'gpt-4',
      toModel: 'gpt-4o',
      provider: 'openai',
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].record_type).toBe('model_switch');
    expect(records[0].from_model).toBe('gpt-4');
    expect(records[0].to_model).toBe('gpt-4o');
    expect(records[0].turn_id).toBeNull();
  });

  it('writes a session_resume record', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await logger.recordLifecycleEvent({
      type: 'session_resume',
      sessionId: 'sess-2',
      resumedSessionId: 'sess-1',
      restoredHistoryItems: 10,
      restoredTokens: 5000,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].record_type).toBe('session_resume');
    expect(records[0].resumed_session_id).toBe('sess-1');
    expect(records[0].restored_history_items).toBe(10);
    expect(records[0].restored_tokens).toBe(5000);
  });

  it('writes a context_truncation record', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await logger.recordLifecycleEvent({
      type: 'context_truncation',
      sessionId: 'sess-1',
      turnId: 'turn-5',
      tokensBefore: 50000,
      tokensAfter: 20000,
      droppedItems: 15,
      reason: 'manual_clear',
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records[0].record_type).toBe('context_truncation');
    expect(records[0].dropped_items).toBe(15);
    expect(records[0].reason).toBe('manual_clear');
  });

  it('writes lifecycle and turn records to the same file', async () => {
    const logger = new TokenUsageLogger(true, logFile);

    await logger.recordLifecycleEvent({
      type: 'compression',
      sessionId: 'sess-1',
      tokensBefore: 10000,
      tokensAfter: 3000,
      compressionModel: 'gpt-4o-mini',
      compressionProvider: 'openai',
    });

    logger.recordEstimate('prompt-mixed', {
      provider: 'openai',
      model: 'gpt-4',
      estimatedTokens: 100,
      estimator: 'openai-tiktoken',
      tiktokenTokens: 90,
    });
    await logger.recordActual('prompt-mixed', {
      actualPromptTokens: 120,
      cachedTokens: 0,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    expect(records).toHaveLength(2);
    expect(records[0].record_type).toBe('compression');
    expect(records[1].record_type).toBe('turn');
  });

  it('is a no-op when disabled', async () => {
    const logger = new TokenUsageLogger(false, logFile);
    await logger.recordLifecycleEvent({
      type: 'model_switch',
      sessionId: 'sess-1',
      fromModel: 'gpt-4',
      toModel: 'gpt-4o',
      provider: 'openai',
    });
    expect(fs.existsSync(logFile)).toBe(false);
  });

  it('provides a default ts when the event omits it', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    await logger.recordLifecycleEvent({
      type: 'compression',
      sessionId: 'sess-1',
      tokensBefore: 100,
      tokensAfter: 50,
      compressionModel: null,
      compressionProvider: null,
    });

    const records = readJsonl(logFile) as Array<Record<string, unknown>>;
    const ts = records[0].ts as string;
    expect(() => new Date(ts).toISOString()).not.toThrow();
  });

  it('recordLifecycleEvent records round-trip through parseTokenUsageLogRecord', async () => {
    const logger = new TokenUsageLogger(true, logFile);
    const event: TokenUsageLifecycleEvent = {
      type: 'provider_switch',
      sessionId: 'sess-1',
      turnId: 'turn-1',
      fromProvider: 'openai',
      toProvider: 'anthropic',
      fromModel: 'gpt-4',
      toModel: 'claude-3',
    };
    await logger.recordLifecycleEvent(event);

    const raw = fs.readFileSync(logFile, 'utf-8').trim();
    const parsed = parseTokenUsageLogRecord(JSON.parse(raw));
    expect(parsed).not.toBeNull();
    expect(parsed?.record_type).toBe('provider_switch');
    if (parsed?.record_type === 'provider_switch') {
      expect(parsed.from_provider).toBe('openai');
      expect(parsed.to_provider).toBe('anthropic');
    }
  });

  it('I/O errors on lifecycle records do not crash (fail-open)', async () => {
    const badPath = path.join(os.tmpdir(), 'invalid\0dir', 'usage.jsonl');
    const logger = new TokenUsageLogger(true, badPath);
    await expect(
      logger.recordLifecycleEvent({
        type: 'compression',
        sessionId: 'sess-1',
        tokensBefore: 100,
        tokensAfter: 50,
        compressionModel: null,
        compressionProvider: null,
      }),
    ).resolves.toBeUndefined();
  });
});
