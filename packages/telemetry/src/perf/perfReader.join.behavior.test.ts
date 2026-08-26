/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests proving the read-time continuation join (AC-3, D1).
 *
 * The perf operation record carries only `operation_id` (derived from the
 * initial prompt-id prefix). Token-usage / session-recording rows each carry
 * their own `prompt_id` (one per send, including continuations). The report
 * derives `operation_id` from each token row's `prompt_id` via
 * `joinKeyFromPromptId` and joins N continuation rows to the SINGLE perf
 * operation — without copying any child id into the perf record.
 *
 * These tests use the real derivation helpers and a real Map join; no mocks.
 */

import { describe, it, expect } from 'bun:test';
import {
  deriveOperationId,
  joinKeyFromPromptId,
  parsePerfRecord,
  PerfOperationRecordSchema,
} from './perfRecords.js';
import type { PerfOperationRecord } from './perfRecords.js';

// ---------------------------------------------------------------------------
// A single perf operation record (no child-id arrays — D1)
// ---------------------------------------------------------------------------

const INITIAL_PROMPT_ID = 'sess-1#agentic-loop#f7e2-aaaa';

const PERF_OPERATION_RECORD: Record<string, unknown> = {
  schema_version: 1,
  record_type: 'operation',
  ts: '2026-08-08T12:00:00.000Z',
  session_id: 'sess-1',
  operation_id: deriveOperationId(INITIAL_PROMPT_ID),
  runtime_id: 'rt-main',
  parent_runtime_id: null,
  subagent_name: null,
  project_hash: 'sha256:project-hash',
  llxprt_version: '0.11.0',
  git_sha: 'abc1234',
  runtime: 'bun-1.3.14',
  platform: 'darwin-arm64',
  provider: 'openai',
  model: 'gpt-4o',
  context_tokens: 1000,
  output_tokens: 500,
  terminal_cols: 120,
  terminal_rows: 40,
  render_mode: 'incremental',
  concurrent_instances: 1,
  status: 'completed',
  client_prepare_ms: 5,
  stream_handler_ms: 10,
  ink_render_ms: 20,
  ink_render_count: 3,
  stdout_bytes: 4096,
  stdout_write_calls: 3,
  stdout_write_sync_ms: 2,
  client_finalize_ms: 1,
  provider_attempts: 1,
  provider_attempt_sum_ms: 800,
  provider_union_ms: 800,
  tool_calls: 2,
  tool_call_sum_ms: 300,
  tool_union_ms: 280,
  agent_activity_union_ms: 1000,
  operation_elapsed_ms: 1200,
  approval_wait_ms: 0,
  unclassified_elapsed_ms: 100,
  session_operation_index: 1,
  uptime_ms: 50000,
};

/**
 * Simulated token-usage rows: one prompt_id per send, including the initial
 * send and every continuation. These mimic the join input the report receives.
 */
const TOKEN_USAGE_PROMPT_IDS = [
  INITIAL_PROMPT_ID,
  `${INITIAL_PROMPT_ID}#continuation#1`,
  `${INITIAL_PROMPT_ID}#continuation#2`,
  `${INITIAL_PROMPT_ID}#continuation#3`,
];

function requireParsedRecord(
  record: ReturnType<typeof parsePerfRecord>,
): NonNullable<ReturnType<typeof parsePerfRecord>> {
  if (record === null) {
    throw new Error('expected a parsed record');
  }
  return record;
}

function requireJoinedOperation(
  record: PerfOperationRecord | undefined,
): PerfOperationRecord {
  if (record === undefined) {
    throw new Error('expected one joined operation');
  }
  return record;
}

// ---------------------------------------------------------------------------
// Prefix invariant (AC-3 separate behavioural test)
// ---------------------------------------------------------------------------

describe('operation_id prefix invariant (AC-3)', () => {
  it('operation_id equals the initial prompt id (no suffix to strip)', () => {
    expect(PERF_OPERATION_RECORD.operation_id).toBe(INITIAL_PROMPT_ID);
  });

  it('every continuation prompt id derives back to the initial prompt id', () => {
    const expectedIds = TOKEN_USAGE_PROMPT_IDS.map(() => INITIAL_PROMPT_ID);
    expect(TOKEN_USAGE_PROMPT_IDS.map(joinKeyFromPromptId)).toStrictEqual(
      expectedIds,
    );
    expect(TOKEN_USAGE_PROMPT_IDS.map(deriveOperationId)).toStrictEqual(
      expectedIds,
    );
  });
});

// ---------------------------------------------------------------------------
// Read-time join (AC-3 read-time join evidence, D1)
// ---------------------------------------------------------------------------

describe('read-time join — N continuation rows → 1 perf operation (D1)', () => {
  it('the perf operation record validates and carries no child-id arrays', () => {
    const parsedResult = parsePerfRecord(PERF_OPERATION_RECORD);
    expect(parsedResult).not.toBeNull();
    const parsed = requireParsedRecord(parsedResult);
    expect(parsed.record_type).toBe('operation');
    expect('prompt_ids' in parsed).toBe(false);
    expect('turn_ids' in parsed).toBe(false);
    expect('prompt_ids_total' in parsed).toBe(false);
    expect('turn_ids_total' in parsed).toBe(false);
  });

  it('joins every continuation token row to the single perf operation', () => {
    // Build the join index the way the report does: operation_id → perf record.
    const perfRecord = PerfOperationRecordSchema.parse(PERF_OPERATION_RECORD);
    const perfByOperationId = new Map<string, PerfOperationRecord>([
      [perfRecord.operation_id, perfRecord],
    ]);

    // For each token-usage row, derive the join key and look up the perf op.
    const joinedOperations = TOKEN_USAGE_PROMPT_IDS.map((promptId) => {
      const operationId = joinKeyFromPromptId(promptId);
      return perfByOperationId.get(operationId);
    });

    // Every token row joined to a perf operation.
    expect(joinedOperations).not.toContain(undefined);

    // All N rows joined to the SAME single perf operation (by identity).
    const uniqueJoined = new Set(joinedOperations);
    expect(uniqueJoined.size).toBe(1);
    const sole = requireJoinedOperation(uniqueJoined.values().next().value);
    expect(sole.operation_id).toBe(INITIAL_PROMPT_ID);

    // And no child id was copied into the perf record.
    expect('prompt_ids' in sole).toBe(false);
    expect('turn_ids' in sole).toBe(false);
  });

  it('does not group an unrelated session under the same operation_id', () => {
    const unrelatedPromptId = 'sess-2#agentic-loop#dead-beef';
    expect(joinKeyFromPromptId(unrelatedPromptId)).not.toBe(INITIAL_PROMPT_ID);
  });
});
