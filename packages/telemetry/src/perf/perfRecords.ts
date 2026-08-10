/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Versioned record schema for the client-side performance telemetry JSONL log
 * (issue #3167).
 *
 * Single Zod declaration: the writer and the tolerant reader both derive their
 * types from the schemas exported here (dev-docs/RULES.md mandates
 * schema-first with Zod).
 *
 * Compatibility rules (spec §2):
 *  - Readers MUST ignore unknown fields (a field addition is NOT a version
 *    bump). Zod's default object mode strips unknown keys, so parsing succeeds.
 *  - A bump means a field changed meaning or was removed. A reader encountering
 *    a version above {@link PERF_SCHEMA_VERSION} MUST skip and count the record,
 *    never coerce it.
 *
 * Decision D1: the v1 record carries NO child `prompt_ids`/`turn_ids` arrays
 * and NO true-count/cap fields. `operation_id` (derived from the top-level
 * prompt-id prefix) is the sole join key; the report performs the exact join
 * at read time.
 */

import { z } from 'zod';
import { createReadStream } from 'node:fs';

export const PERF_SCHEMA_VERSION = 1;

export const PERF_RECORD_TYPE_OPERATION = 'operation';
export const PERF_RECORD_TYPE_MEMORY_SAMPLE = 'memory_sample';

/**
 * The seven terminal operation statuses (spec §1.3), including `superseded`,
 * which is load-bearing because the ownership release in `useSubmitQuery` is
 * guarded by `isCurrentTurn`, so a superseded operation never reaches it.
 */
export const PERF_TERMINAL_STATUSES = [
  'completed',
  'error',
  'cancelled_before_send',
  'cancelled_during_api',
  'cancelled_during_tool',
  'cancelled_during_approval',
  'superseded',
] as const;

export type PerfTerminalStatus = (typeof PERF_TERMINAL_STATUSES)[number];

// A non-empty string. Identity/build/comparison-dimension strings must not be
// empty — an empty identity string is rejected at the schema boundary.
const nonEmptyString = z.string().min(1);

// ISO 8601 timestamp with timezone (Z or offset). Rejects bare local times.
const isoTimestamp = z.string().min(1).datetime({ offset: true });

// Finite, non-negative number. Used for durations, bytes, memory, uptime,
// and sample ages.
const finiteNonNeg = z.number().finite().nonnegative();

// Finite number that may be negative (the honest residual).
const finiteSigned = z.number().finite();

// Non-negative integer. Used for counts, tokens, and indices.
const nonNegInt = z.number().int().nonnegative();

// Positive integer (>= 1). Used for concurrent_instances.
const posInt = z.number().int().min(1);

// ---------------------------------------------------------------------------
// Operation record (record_type: "operation")
// ---------------------------------------------------------------------------

export const PerfOperationRecordSchema = z.object({
  // --- envelope ---
  // schema_version accepts both the current version (1) and the normalized
  // v0 form. A v0 record is an unversioned legacy object that fully matches
  // the operation payload shape; classifyPerfLine normalizes it at read time
  // (spec §2, following the tokenUsageRecords pattern). The writer always
  // emits PERF_SCHEMA_VERSION (1); v0 is only reachable through normalization.
  schema_version: z.union([z.literal(0), z.literal(PERF_SCHEMA_VERSION)]),
  record_type: z.literal(PERF_RECORD_TYPE_OPERATION),
  ts: isoTimestamp,

  // --- identity (reuses #3130's key names verbatim) ---
  session_id: nonEmptyString,
  operation_id: nonEmptyString,
  runtime_id: nonEmptyString,
  parent_runtime_id: nonEmptyString.nullable(),
  subagent_name: nonEmptyString.nullable(),
  project_hash: nonEmptyString,

  // --- build identity (the x-axis) ---
  llxprt_version: nonEmptyString,
  git_sha: nonEmptyString,
  runtime: nonEmptyString,
  platform: nonEmptyString,

  // --- comparison dimensions (compare like with like, never pooled) ---
  provider: nonEmptyString,
  model: nonEmptyString,
  context_tokens: nonNegInt,
  output_tokens: nonNegInt,
  // Geometry: non-negative integers (unknown terminal geometry is zero — P12).
  // concurrent_instances remains a positive integer (minimum 1 — D3).
  terminal_cols: nonNegInt,
  terminal_rows: nonNegInt,
  render_mode: nonEmptyString,
  concurrent_instances: posInt,

  // --- terminal status ---
  status: z.enum(PERF_TERMINAL_STATUSES),

  // --- client work: directly measured, additive among themselves ---
  client_prepare_ms: finiteNonNeg,
  stream_handler_ms: finiteNonNeg,
  ink_render_ms: finiteNonNeg,
  ink_render_count: nonNegInt,
  stdout_bytes: finiteNonNeg,
  stdout_write_calls: nonNegInt,
  stdout_write_sync_ms: finiteNonNeg,
  client_finalize_ms: finiteNonNeg,

  // --- provider/tool work: overlapping, NOT additive with client phases ---
  provider_attempts: nonNegInt,
  provider_attempt_sum_ms: finiteNonNeg,
  provider_union_ms: finiteNonNeg,
  tool_calls: nonNegInt,
  tool_call_sum_ms: finiteNonNeg,
  tool_union_ms: finiteNonNeg,
  agent_activity_union_ms: finiteNonNeg,

  // --- elapsed ---
  operation_elapsed_ms: finiteNonNeg,
  approval_wait_ms: finiteNonNeg,
  unclassified_elapsed_ms: finiteSigned,

  // --- memory (OPTIONAL: present iff memory enabled; omitted, never zero) ---
  rss_bytes: finiteNonNeg.optional(),
  heap_used_bytes: finiteNonNeg.optional(),
  external_bytes: finiteNonNeg.optional(),
  array_buffers_bytes: finiteNonNeg.optional(),

  // --- always present ---
  session_operation_index: nonNegInt,
  uptime_ms: finiteNonNeg,
});

export type PerfOperationRecord = z.infer<typeof PerfOperationRecordSchema>;

// ---------------------------------------------------------------------------
// Memory sample record (record_type: "memory_sample")
// ---------------------------------------------------------------------------

export const PerfMemorySampleRecordSchema = z.object({
  schema_version: z.literal(PERF_SCHEMA_VERSION),
  record_type: z.literal(PERF_RECORD_TYPE_MEMORY_SAMPLE),
  ts: isoTimestamp,
  rss_bytes: finiteNonNeg,
  heap_used_bytes: finiteNonNeg,
  external_bytes: finiteNonNeg,
  array_buffers_bytes: finiteNonNeg,
  uptime_ms: finiteNonNeg,
  ms_since_last_operation: finiteNonNeg,
});

export type PerfMemorySampleRecord = z.infer<
  typeof PerfMemorySampleRecordSchema
>;

// ---------------------------------------------------------------------------
// Full record union (discriminated on record_type)
// ---------------------------------------------------------------------------

export const PerfRecordSchema = z.discriminatedUnion('record_type', [
  PerfOperationRecordSchema,
  PerfMemorySampleRecordSchema,
]);

export type PerfRecord = z.infer<typeof PerfRecordSchema>;

// ---------------------------------------------------------------------------
// operation_id derivation (settled §3 / §9 — derived, NOT minted+propagated)
// ---------------------------------------------------------------------------

/**
 * Derives the operation join key from a prompt id by taking the first segment
 * before any `#continuation#` marker.
 *
 * `AgenticLoop.generateContinuationPromptId()` returns
 * `${initialPromptId}#continuation#${n}` for continuations, so taking the first
 * `split('#continuation#')` segment recovers the initial id, which is the
 * operation's sole join key. An initial id (no marker) is returned byte-identical.
 * Any occurrence of the marker — terminal or not, numeric or not — begins the
 * continuation suffix. A CLI-fallback id without the marker is preserved.
 */
export function deriveOperationId(promptId: string): string {
  return promptId.split('#continuation#')[0];
}

/**
 * Read-time join key derived from a token-usage / session-recording row's
 * `prompt_id`. Same derivation as {@link deriveOperationId}: continuations
 * collapse to their shared initial-prompt-id prefix so N continuation rows
 * join to the SINGLE perf operation (D1) without any child id on the perf
 * record.
 */
export function joinKeyFromPromptId(promptId: string): string {
  return promptId.split('#continuation#')[0];
}

// ---------------------------------------------------------------------------
// Tolerant per-line classification (external JSONL input — defensive parsing)
// ---------------------------------------------------------------------------

/**
 * Per-line classification of a parsed JSON object from a perf JSONL file.
 *
 * The reader uses this richer result (rather than a bare `PerfRecord | null`)
 * so self-health counters can distinguish future-version skips, unversioned
 * legacy rows, and genuinely malformed records.
 */
export type PerfLineClassification =
  | { readonly kind: 'ok'; readonly record: PerfRecord }
  | { readonly kind: 'future_version'; readonly schemaVersion: number }
  | { readonly kind: 'unversioned' }
  | { readonly kind: 'malformed' };

function isStringRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  // Arrays are not string records — they must be classified as `malformed`
  // (not `unversioned`), so `Array.isArray` is excluded here.
  return !Array.isArray(value);
}

/**
 * Classifies a parsed JSON object (NOT a raw text line) from a perf JSONL file.
 *
 * - A record with NO `schema_version` and NO `record_type` that FULLY matches
 *   the operation payload shape is normalized to a v0 operation record
 *   (`{ schema_version: 0, record_type: 'operation' }`) — following the
 *   tokenUsageRecords pattern (spec §2). An incomplete or arbitrary
 *   unversioned object that does not validate against the operation schema is
 *   `unversioned` (counted, never fake-normalized).
 * - A record whose numeric `schema_version` exceeds {@link PERF_SCHEMA_VERSION}
 *   is `future_version` (skip+count, never coerce).
 * - Otherwise it is validated against {@link PerfRecordSchema}; unknown fields
 *   are ignored (stripped). Success → `ok`; failure → `malformed`.
 * - Never throws.
 */
export function classifyPerfLine(line: unknown): PerfLineClassification {
  if (!isStringRecord(line)) {
    return { kind: 'malformed' };
  }

  const hasSchemaVersion = 'schema_version' in line;
  const hasRecordType = 'record_type' in line;

  if (!hasSchemaVersion && !hasRecordType) {
    // v0 normalization: an unversioned object that fully matches the
    // operation payload shape normalizes to a v0 operation record. An
    // incomplete/arbitrary object that fails validation remains unversioned.
    const normalized = {
      ...line,
      schema_version: 0,
      record_type: PERF_RECORD_TYPE_OPERATION,
    };
    const v0Result = PerfRecordSchema.safeParse(normalized);
    if (v0Result.success) {
      return { kind: 'ok', record: v0Result.data };
    }
    return { kind: 'unversioned' };
  }

  const version = line.schema_version;
  if (typeof version === 'number' && version > PERF_SCHEMA_VERSION) {
    return { kind: 'future_version', schemaVersion: version };
  }

  const result = PerfRecordSchema.safeParse(line);
  if (result.success) {
    return { kind: 'ok', record: result.data };
  }
  return { kind: 'malformed' };
}

/**
 * Tolerant per-line reader. Returns the parsed record or `null` (never throws).
 * Equivalent to {@link classifyPerfLine} for callers that only need the record.
 */
export function parsePerfRecord(line: unknown): PerfRecord | null {
  const classification = classifyPerfLine(line);
  return classification.kind === 'ok' ? classification.record : null;
}

// ---------------------------------------------------------------------------
// Streaming JSONL reader (external files — never reads the whole file)
// ---------------------------------------------------------------------------

/**
 * Incremental classification of a single line yielded by the streaming reader.
 *
 * Superset of {@link PerfLineClassification}: adds `blank` (whitespace-only
 * line) and `truncated` (final unterminated line that did not parse, e.g.
 * SIGKILL mid-append).
 */
export type PerfStreamEntry =
  | { readonly kind: 'ok'; readonly record: PerfRecord }
  | { readonly kind: 'future_version'; readonly schemaVersion: number }
  | { readonly kind: 'unversioned' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'blank' }
  | { readonly kind: 'truncated' };

export interface PerfReaderCounts {
  /** Lines that parsed to a valid current-version perf record. */
  readonly parsed: number;
  /** Complete (newline-terminated) lines that failed to parse. */
  readonly malformed: number;
  /** Records whose schema_version is above the known version (skipped). */
  readonly futureVersion: number;
  /** Records with no schema_version and no record_type (legacy/unknown). */
  readonly unversioned: number;
  /** The final unterminated line that did not parse (SIGKILL mid-append). */
  readonly truncated: number;
  /** Blank / whitespace-only lines. */
  readonly blank: number;
}

export interface PerfReaderResult {
  readonly records: readonly PerfRecord[];
  readonly counts: PerfReaderCounts;
}

/**
 * Streams perf JSONL entries from a file path, yielding classification outcomes
 * incrementally WITHOUT reading the whole file into memory.
 *
 * P11 uses this to process a 24/7 file that never closes.
 *
 * The line-splitting + classification engine lives in the package-private
 * module `./perfRecordsStream.js` (not exported from package.json). It is
 * loaded with a dynamic import so the static dependency graph stays
 * one-directional — `perfRecordsStream` imports `classifyPerfLine` from this
 * module, and this module never statically imports it back, avoiding an import
 * cycle.
 *
 * Genuine I/O failures (missing file, permission denied) propagate as a
 * rejection; those are not line-content problems.
 */
export async function* streamPerfRecords(
  filePath: string,
): AsyncGenerator<PerfStreamEntry> {
  const { streamPerfFromReadable } = await import('./perfRecordsStream.js');
  yield* streamPerfFromReadable(createReadStream(filePath));
}

/**
 * Bounded convenience collector: streams the file with
 * {@link streamPerfRecords} and accumulates the results into records + counts.
 * P11 should prefer the streaming API for 24/7 files; this collector is kept
 * for tests and bounded batch reads.
 *
 * Genuine I/O failures (missing file, permission denied) propagate as a
 * rejection; those are not line-content problems.
 */
export async function readPerfRecords(
  filePath: string,
): Promise<PerfReaderResult> {
  const records: PerfRecord[] = [];
  let parsed = 0;
  let malformed = 0;
  let futureVersion = 0;
  let unversioned = 0;
  let truncated = 0;
  let blank = 0;

  for await (const entry of streamPerfRecords(filePath)) {
    switch (entry.kind) {
      case 'ok':
        records.push(entry.record);
        parsed++;
        break;
      case 'malformed':
        malformed++;
        break;
      case 'future_version':
        futureVersion++;
        break;
      case 'unversioned':
        unversioned++;
        break;
      case 'truncated':
        truncated++;
        break;
      case 'blank':
        blank++;
        break;
      default: {
        const _exhaustive: never = entry;
        throw new Error(
          `Internal invariant violation: unhandled PerfStreamEntry kind: ${JSON.stringify(_exhaustive)}`,
        );
      }
    }
  }

  return {
    records,
    counts: { parsed, malformed, futureVersion, unversioned, truncated, blank },
  };
}
