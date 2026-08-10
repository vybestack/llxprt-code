/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Record-size benchmark for the actual v1 perf schema (D5).
 *
 * Serializes a representative `operation` record (INCLUDING the optional
 * memory columns) and a `memory_sample` record from the real schema,
 * validates both, and reports the byte size of a single JSONL line. P08 uses
 * this output to derive retention constants (max-bytes / max-files /
 * maintenance-interval / diagnostic-rate-limit).
 *
 * Run: `bun packages/telemetry/src/perf/perfRecordSize.bench.ts`
 *
 * This is a measurement script, not a test file; it exits non-zero if either
 * record fails to validate.
 */

import {
  PERF_SCHEMA_VERSION,
  PerfRecordSchema,
  type PerfOperationRecord,
  type PerfMemorySampleRecord,
} from './perfRecords.js';

// Representative operation record WITH the optional memory columns, so the
// measured line is the largest single-record shape a writer produces.
const operationWithMemory: PerfOperationRecord = {
  schema_version: PERF_SCHEMA_VERSION,
  record_type: 'operation',
  ts: '2026-08-08T12:00:00.000Z',
  session_id: 'sess-abc1234',
  operation_id: 'sess-abc1234#agentic-loop#f7e2-9a8b-7c6d-5e4f',
  runtime_id: 'rt-550e8400-e29b-41d4-a716-446655440000',
  parent_runtime_id: null,
  subagent_name: null,
  project_hash: 'sha256:1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
  llxprt_version: '0.11.0',
  git_sha: 'abc1234',
  runtime: 'bun-1.3.14',
  platform: 'darwin-arm64',
  provider: 'openai',
  model: 'gpt-4o',
  context_tokens: 48213,
  output_tokens: 1842,
  terminal_cols: 120,
  terminal_rows: 40,
  render_mode: 'incremental',
  concurrent_instances: 2,
  status: 'completed',
  client_prepare_ms: 3,
  stream_handler_ms: 47,
  ink_render_ms: 128,
  ink_render_count: 312,
  stdout_bytes: 2845621,
  stdout_write_calls: 312,
  stdout_write_sync_ms: 91,
  client_finalize_ms: 1,
  provider_attempts: 1,
  provider_attempt_sum_ms: 8421,
  provider_union_ms: 8421,
  tool_calls: 7,
  tool_call_sum_ms: 14302,
  tool_union_ms: 12884,
  agent_activity_union_ms: 19840,
  operation_elapsed_ms: 31204,
  approval_wait_ms: 4210,
  unclassified_elapsed_ms: 611,
  rss_bytes: 312_547_840,
  heap_used_bytes: 184_322_560,
  external_bytes: 47_001_088,
  array_buffers_bytes: 2_490_368,
  session_operation_index: 14,
  uptime_ms: 1_842_317,
};

const memorySample: PerfMemorySampleRecord = {
  schema_version: PERF_SCHEMA_VERSION,
  record_type: 'memory_sample',
  ts: '2026-08-08T12:01:00.000Z',
  rss_bytes: 318_004_224,
  heap_used_bytes: 186_122_240,
  external_bytes: 47_312_896,
  array_buffers_bytes: 2_501_888,
  uptime_ms: 1_902_317,
  ms_since_last_operation: 124_013,
};

function assertValid(label: string, record: unknown): void {
  const result = PerfRecordSchema.safeParse(record);
  if (!result.success) {
    process.stderr.write(`${label} FAILED schema validation:\n`);
    for (const issue of result.error.issues) {
      process.stderr.write(`  ${issue.path.join('.')}: ${issue.message}\n`);
    }
    process.exit(1);
  }
}

assertValid('operation (with memory)', operationWithMemory);
assertValid('memory_sample', memorySample);

const operationLine = JSON.stringify(operationWithMemory) + '\n';
const memorySampleLine = JSON.stringify(memorySample) + '\n';

const operationBytes = Buffer.byteLength(operationLine, 'utf8');
const memorySampleBytes = Buffer.byteLength(memorySampleLine, 'utf8');

process.stdout.write('perf record-size benchmark (D5) — actual v1 schema\n');
process.stdout.write(
  `  operation (with memory) JSONL line : ${operationBytes} bytes (${operationLine.length} chars)\n`,
);
process.stdout.write(
  `  memory_sample JSONL line          : ${memorySampleBytes} bytes (${memorySampleLine.length} chars)\n`,
);
process.stdout.write(
  `  combined per operation pair       : ${operationBytes + memorySampleBytes} bytes\n`,
);
