/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  TOKEN_USAGE_SCHEMA_VERSION,
  parseTokenUsageLogRecord,
  SerializedTokenUsageTurnRecordSchema,
  SerializedTokenUsageLifecycleRecordSchema,
  SerializedTokenUsageLogRecordSchema,
} from './tokenUsageRecords.js';

describe('TOKEN_USAGE_SCHEMA_VERSION', () => {
  it('is 1', () => {
    expect(TOKEN_USAGE_SCHEMA_VERSION).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Minimal valid legacy + v1 turn records used across tests
// ---------------------------------------------------------------------------

const LEGACY_TURN = {
  ts: '2025-01-01T00:00:00.000Z',
  prompt_id: 'p-legacy',
  provider: 'openai',
  model: 'gpt-4',
  estimated_tokens: 100,
  estimator: 'openai-tiktoken',
  tiktoken_tokens: 95,
  tiktoken_estimation_failed: false,
  actual_prompt_tokens: 120,
  cached_tokens: 0,
  effective_actual_tokens: 120,
};

function v1Turn(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    record_type: 'turn',
    schema_version: 1,
    ts: '2025-06-01T00:00:00.000Z',
    prompt_id: 'p-1',
    provider: 'openai',
    model: 'gpt-4',
    estimated_tokens: 100,
    estimator: 'openai-tiktoken',
    tiktoken_tokens: 95,
    tiktoken_estimation_failed: false,
    actual_prompt_tokens: 120,
    cached_tokens: 0,
    effective_actual_tokens: 120,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Turn record parsing
// ---------------------------------------------------------------------------

describe('parseTokenUsageLogRecord — legacy normalization', () => {
  it('normalises a legacy record (no schema_version, no record_type) as v0 turn', () => {
    const result = parseTokenUsageLogRecord(LEGACY_TURN);
    expect(result).not.toBeNull();
    expect(result?.record_type).toBe('turn');
    expect(result?.schema_version).toBe(0);
    if (result?.record_type !== 'turn') {
      throw new Error(`expected turn record, got ${result?.record_type}`);
    }
    expect(result.prompt_id).toBe('p-legacy');
  });

  it('preserves all 17 existing fields from a legacy record', () => {
    const result = parseTokenUsageLogRecord(LEGACY_TURN);
    expect(result).not.toBeNull();
    if (result?.record_type !== 'turn') {
      throw new Error(`expected turn record, got ${result?.record_type}`);
    }
    expect(result.ts).toBe('2025-01-01T00:00:00.000Z');
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4');
    expect(result.estimated_tokens).toBe(100);
    expect(result.estimator).toBe('openai-tiktoken');
    expect(result.tiktoken_tokens).toBe(95);
    expect(result.tiktoken_estimation_failed).toBe(false);
    expect(result.actual_prompt_tokens).toBe(120);
    expect(result.cached_tokens).toBe(0);
    expect(result.effective_actual_tokens).toBe(120);
  });

  it('accepts legacy records with null tiktoken_tokens', () => {
    const result = parseTokenUsageLogRecord({
      ...LEGACY_TURN,
      tiktoken_tokens: null,
    });
    expect(result).not.toBeNull();
    if (result?.record_type !== 'turn') {
      throw new Error(`expected turn record, got ${result?.record_type}`);
    }
    expect(result.tiktoken_tokens).toBeNull();
  });
});

describe('parseTokenUsageLogRecord — v1 turn records', () => {
  it('round-trips a minimal v1 turn record', () => {
    const result = parseTokenUsageLogRecord(v1Turn());
    expect(result).not.toBeNull();
    expect(result?.record_type).toBe('turn');
    expect(result?.schema_version).toBe(1);
  });

  it('round-trips optional join-key fields', () => {
    const result = parseTokenUsageLogRecord(
      v1Turn({
        session_id: 'sess-1',
        turn_id: 'turn-1',
        user_turn: 1,
        step: 3,
        runtime_id: 'rt-1',
        parent_runtime_id: null,
        subagent_name: null,
      }),
    );
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('turn');
    if (result.record_type !== 'turn')
      throw new Error('expected a turn record');
    expect(result.session_id).toBe('sess-1');
    expect(result.turn_id).toBe('turn-1');
    expect(result.user_turn).toBe(1);
    expect(result.step).toBe(3);
    expect(result.runtime_id).toBe('rt-1');
    expect(result.parent_runtime_id).toBeNull();
    expect(result.subagent_name).toBeNull();
  });

  it('round-trips optional cost fields', () => {
    const result = parseTokenUsageLogRecord(
      v1Turn({
        output_tokens: 50,
        reasoning_tokens: 10,
        cache_write_tokens: 5,
        cache_read_tokens: 20,
        tool_tokens: 8,
        total_tokens: 198,
      }),
    );
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('turn');
    if (result.record_type !== 'turn')
      throw new Error('expected a turn record');
    expect(result.output_tokens).toBe(50);
    expect(result.reasoning_tokens).toBe(10);
    expect(result.cache_write_tokens).toBe(5);
    expect(result.cache_read_tokens).toBe(20);
    expect(result.tool_tokens).toBe(8);
    expect(result.total_tokens).toBe(198);
  });

  it('round-trips attempt fields', () => {
    const result = parseTokenUsageLogRecord(
      v1Turn({
        attempt_index: 1,
        attempt_outcome: 'error',
        retry_reason: 'rate_limit',
        http_status: 429,
        backend_profile: 'gpt-4o-mini',
      }),
    );
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('turn');
    if (result.record_type !== 'turn')
      throw new Error('expected a turn record');
    expect(result.attempt_index).toBe(1);
    expect(result.attempt_outcome).toBe('error');
    expect(result.retry_reason).toBe('rate_limit');
    expect(result.http_status).toBe(429);
    expect(result.backend_profile).toBe('gpt-4o-mini');
  });

  it('round-trips tool-call attribution', () => {
    const result = parseTokenUsageLogRecord(
      v1Turn({
        tool_calls: [
          {
            call_id: 'call-1',
            tool_name: 'read_file',
            result_tokens: 42,
            was_truncated: false,
          },
        ],
        new_tool_result_tokens: 42,
        carried_tool_result_tokens: 100,
      }),
    );
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('turn');
    if (result.record_type !== 'turn')
      throw new Error('expected a turn record');
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls?.[0].call_id).toBe('call-1');
    expect(result.tool_calls?.[0].tool_name).toBe('read_file');
    expect(result.tool_calls?.[0].result_tokens).toBe(42);
    expect(result.tool_calls?.[0].was_truncated).toBe(false);
    expect(result.new_tool_result_tokens).toBe(42);
    expect(result.carried_tool_result_tokens).toBe(100);
  });

  it('round-trips request-shape provenance fields', () => {
    const result = parseTokenUsageLogRecord(
      v1Turn({
        instructions_tokens: 200,
        tools_schema_tokens: 300,
        history_tokens: 400,
        media_tokens: 10,
        injected_tokens: 5,
        prompt_cache_key: 'cache-key-abc',
        prefix_fingerprint: 'sha256:deadbeef',
        prefix_fingerprint_changed: true,
      }),
    );
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('turn');
    if (result.record_type !== 'turn')
      throw new Error('expected a turn record');
    expect(result.instructions_tokens).toBe(200);
    expect(result.tools_schema_tokens).toBe(300);
    expect(result.history_tokens).toBe(400);
    expect(result.media_tokens).toBe(10);
    expect(result.injected_tokens).toBe(5);
    expect(result.prompt_cache_key).toBe('cache-key-abc');
    expect(result.prefix_fingerprint).toBe('sha256:deadbeef');
    expect(result.prefix_fingerprint_changed).toBe(true);
  });

  it('accepts null prefix_fingerprint_changed', () => {
    const result = parseTokenUsageLogRecord(
      v1Turn({ prefix_fingerprint_changed: null }),
    );
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('turn');
    if (result.record_type !== 'turn')
      throw new Error('expected a turn record');
    expect(result.prefix_fingerprint_changed).toBeNull();
  });

  it('omits cost fields when absent (no zero-fill)', () => {
    const result = parseTokenUsageLogRecord(v1Turn());
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('turn');
    if (result.record_type !== 'turn')
      throw new Error('expected a turn record');
    expect(result.output_tokens).toBeUndefined();
    expect(result.total_tokens).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Lifecycle record parsing
// ---------------------------------------------------------------------------

describe('parseTokenUsageLogRecord — lifecycle records', () => {
  it('round-trips a compression record', () => {
    const result = parseTokenUsageLogRecord({
      record_type: 'compression',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      tokens_before: 10000,
      tokens_after: 3000,
      compression_model: 'gpt-4o-mini',
      compression_provider: 'openai',
    });
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('compression');
    if (result.record_type !== 'compression')
      throw new Error('expected a compression record');
    expect(result.tokens_before).toBe(10000);
    expect(result.tokens_after).toBe(3000);
    expect(result.compression_model).toBe('gpt-4o-mini');
    expect(result.compression_provider).toBe('openai');
  });

  it('round-trips a compression record with cost fields', () => {
    const result = parseTokenUsageLogRecord({
      record_type: 'compression',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-1',
      turn_id: null,
      tokens_before: 10000,
      tokens_after: 3000,
      compression_model: null,
      compression_provider: null,
      compression_prompt_tokens: 9000,
      compression_output_tokens: 500,
    });
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('compression');
    if (result.record_type !== 'compression')
      throw new Error('expected a compression record');
    expect(result.compression_prompt_tokens).toBe(9000);
    expect(result.compression_output_tokens).toBe(500);
    expect(result.turn_id).toBeNull();
    expect(result.compression_model).toBeNull();
  });

  it('round-trips a provider_switch record', () => {
    const result = parseTokenUsageLogRecord({
      record_type: 'provider_switch',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      from_provider: 'openai',
      to_provider: 'anthropic',
      from_model: 'gpt-4',
      to_model: 'claude-3',
    });
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('provider_switch');
    if (result.record_type !== 'provider_switch')
      throw new Error('expected a provider_switch record');
    expect(result.from_provider).toBe('openai');
    expect(result.to_provider).toBe('anthropic');
    expect(result.from_model).toBe('gpt-4');
    expect(result.to_model).toBe('claude-3');
  });

  it('round-trips a provider_switch record with null from fields', () => {
    const result = parseTokenUsageLogRecord({
      record_type: 'provider_switch',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-1',
      turn_id: null,
      from_provider: null,
      to_provider: 'anthropic',
      from_model: null,
      to_model: null,
    });
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('provider_switch');
    if (result.record_type !== 'provider_switch')
      throw new Error('expected a provider_switch record');
    expect(result.from_provider).toBeNull();
    expect(result.from_model).toBeNull();
    expect(result.to_model).toBeNull();
  });

  it('round-trips a model_switch record', () => {
    const result = parseTokenUsageLogRecord({
      record_type: 'model_switch',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-1',
      turn_id: 'turn-1',
      from_model: 'gpt-4',
      to_model: 'gpt-4o',
      provider: 'openai',
    });
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('model_switch');
    if (result.record_type !== 'model_switch')
      throw new Error('expected a model_switch record');
    expect(result.from_model).toBe('gpt-4');
    expect(result.to_model).toBe('gpt-4o');
    expect(result.provider).toBe('openai');
  });

  it('round-trips a session_resume record', () => {
    const result = parseTokenUsageLogRecord({
      record_type: 'session_resume',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-2',
      turn_id: null,
      resumed_session_id: 'sess-1',
      restored_history_items: 10,
      restored_tokens: 5000,
    });
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('session_resume');
    if (result.record_type !== 'session_resume')
      throw new Error('expected a session_resume record');
    expect(result.resumed_session_id).toBe('sess-1');
    expect(result.restored_history_items).toBe(10);
    expect(result.restored_tokens).toBe(5000);
  });

  it('round-trips a session_resume record with null restored_tokens', () => {
    const result = parseTokenUsageLogRecord({
      record_type: 'session_resume',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-2',
      turn_id: null,
      resumed_session_id: null,
      restored_history_items: 0,
      restored_tokens: null,
    });
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('session_resume');
    if (result.record_type !== 'session_resume')
      throw new Error('expected a session_resume record');
    expect(result.resumed_session_id).toBeNull();
    expect(result.restored_tokens).toBeNull();
  });

  it('round-trips a context_truncation record', () => {
    const result = parseTokenUsageLogRecord({
      record_type: 'context_truncation',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-1',
      turn_id: 'turn-5',
      tokens_before: 50000,
      tokens_after: 20000,
      dropped_items: 15,
      reason: 'manual_clear',
    });
    expect(result).not.toBeNull();
    if (result === null) throw new Error('expected a parseable record');
    expect(result.record_type).toBe('context_truncation');
    if (result.record_type !== 'context_truncation')
      throw new Error('expected a context_truncation record');
    expect(result.tokens_before).toBe(50000);
    expect(result.tokens_after).toBe(20000);
    expect(result.dropped_items).toBe(15);
    expect(result.reason).toBe('manual_clear');
  });
});

// ---------------------------------------------------------------------------
// Rejection and robustness
// ---------------------------------------------------------------------------

describe('parseTokenUsageLogRecord — rejection', () => {
  it('returns null for null', () => {
    expect(parseTokenUsageLogRecord(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(parseTokenUsageLogRecord(undefined)).toBeNull();
  });

  it('returns null for a string', () => {
    expect(parseTokenUsageLogRecord('hello')).toBeNull();
  });

  it('returns null for a number', () => {
    expect(parseTokenUsageLogRecord(42)).toBeNull();
  });

  it('returns null for an empty object', () => {
    expect(parseTokenUsageLogRecord({})).toBeNull();
  });

  it('returns null for a turn record missing required fields', () => {
    expect(parseTokenUsageLogRecord({ record_type: 'turn' })).toBeNull();
  });

  it('returns null for an unknown record_type', () => {
    expect(
      parseTokenUsageLogRecord({
        ...v1Turn(),
        record_type: 'unknown_type',
      }),
    ).toBeNull();
  });

  it('returns null for a lifecycle record missing required fields', () => {
    expect(
      parseTokenUsageLogRecord({
        record_type: 'compression',
        schema_version: 1,
        ts: '2025-06-01T00:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('does not throw on an array', () => {
    expect(() => parseTokenUsageLogRecord([1, 2, 3])).not.toThrow();
    expect(parseTokenUsageLogRecord([1, 2, 3])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Schema exports
// ---------------------------------------------------------------------------

describe('exported Zod schemas', () => {
  it('SerializedTokenUsageTurnRecordSchema validates a complete v1 record', () => {
    const result = SerializedTokenUsageTurnRecordSchema.safeParse(v1Turn());
    expect(result.success).toBe(true);
  });

  it('SerializedTokenUsageLifecycleRecordSchema validates a compression record', () => {
    const result = SerializedTokenUsageLifecycleRecordSchema.safeParse({
      record_type: 'compression',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-1',
      turn_id: null,
      tokens_before: 100,
      tokens_after: 50,
      compression_model: null,
      compression_provider: null,
    });
    expect(result.success).toBe(true);
  });

  it('SerializedTokenUsageLogRecordSchema accepts both turn and lifecycle', () => {
    const turnResult = SerializedTokenUsageLogRecordSchema.safeParse(v1Turn());
    expect(turnResult.success).toBe(true);

    const lifecycleResult = SerializedTokenUsageLogRecordSchema.safeParse({
      record_type: 'model_switch',
      schema_version: 1,
      ts: '2025-06-01T00:00:00.000Z',
      session_id: 'sess-1',
      turn_id: null,
      from_model: 'gpt-4',
      to_model: 'gpt-4o',
      provider: 'openai',
    });
    expect(lifecycleResult.success).toBe(true);
  });
});
