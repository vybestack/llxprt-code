/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';

/**
 * Versioned record schema for the per-session token-usage JSONL log.
 *
 * Every record carries `schema_version` and a `record_type` discriminator.
 * Legacy records written before versioning (no `schema_version`, no
 * `record_type`) are normalised to version 0 turn records by the tolerant
 * reader so the existing corpus stays readable.
 */

export const TOKEN_USAGE_SCHEMA_VERSION = 1;

export type TokenUsageAttemptOutcome =
  | 'success'
  | 'error'
  | 'aborted'
  | 'abandoned';

// ---------------------------------------------------------------------------
// Serialized turn record
// ---------------------------------------------------------------------------

const TokenEstimatorSchema = z.enum([
  'openai-tiktoken',
  'anthropic-char',
  'core-fallback',
]);

const AttemptOutcomeSchema = z.enum([
  'success',
  'error',
  'aborted',
  'abandoned',
]);

const ToolCallEntrySchema = z.object({
  call_id: z.string(),
  tool_name: z.string(),
  result_tokens: z.number(),
  was_truncated: z.boolean(),
});

/**
 * Zod schema for the serialized turn record.
 *
 * The first 17 fields are the existing estimator/calibration columns (AC-11),
 * kept byte-identical.  The remaining optional fields are the join-key,
 * cost, attempt, tool-attribution, and request-shape additions from
 * AC-1/3/4/5/6 — all optional so this slice emits them only when populated.
 */
export const SerializedTokenUsageTurnRecordSchema = z.object({
  record_type: z.literal('turn'),
  schema_version: z.number(),
  // --- existing 17 fields (AC-11) ---
  ts: z.string(),
  prompt_id: z.string(),
  provider: z.string(),
  model: z.string(),
  protocol: z.string().optional(),
  estimated_tokens: z.number(),
  estimator: TokenEstimatorSchema,
  estimator_method: z.enum(['exact', 'calibrated']).optional(),
  estimator_family: z.string().optional(),
  estimator_version: z.string().optional(),
  asset_revision: z.string().optional(),
  projection_revision: z.number().optional(),
  tiktoken_tokens: z.number().nullable(),
  tiktoken_estimation_failed: z.boolean(),
  actual_prompt_tokens: z.number(),
  cached_tokens: z.number(),
  effective_actual_tokens: z.number(),
  // --- AC-1 join keys ---
  session_id: z.string().optional(),
  turn_id: z.string().nullable().optional(),
  user_turn: z.number().nullable().optional(),
  step: z.number().nullable().optional(),
  runtime_id: z.string().optional(),
  parent_runtime_id: z.string().nullable().optional(),
  subagent_name: z.string().nullable().optional(),
  // --- AC-3 cost fields (omitted when unreported, never zero-filled) ---
  output_tokens: z.number().optional(),
  reasoning_tokens: z.number().optional(),
  cache_write_tokens: z.number().optional(),
  cache_read_tokens: z.number().optional(),
  tool_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  // --- AC-4 attempt fields ---
  attempt_index: z.number().optional(),
  attempt_outcome: AttemptOutcomeSchema.optional(),
  retry_reason: z.string().optional(),
  http_status: z.number().optional(),
  backend_profile: z.string().optional(),
  // --- AC-5 tool attribution ---
  tool_calls: z.array(ToolCallEntrySchema).optional(),
  new_tool_result_tokens: z.number().optional(),
  carried_tool_result_tokens: z.number().optional(),
  // --- AC-6 request-shape provenance ---
  instructions_tokens: z.number().optional(),
  tools_schema_tokens: z.number().optional(),
  history_tokens: z.number().optional(),
  media_tokens: z.number().optional(),
  injected_tokens: z.number().optional(),
  prompt_cache_key: z.string().optional(),
  prefix_fingerprint: z.string().optional(),
  prefix_fingerprint_changed: z.boolean().nullable().optional(),
});

export type SerializedTokenUsageTurnRecord = z.infer<
  typeof SerializedTokenUsageTurnRecordSchema
>;

// ---------------------------------------------------------------------------
// Serialized lifecycle records
// ---------------------------------------------------------------------------

const SerializedCompressionRecordSchema = z.object({
  record_type: z.literal('compression'),
  schema_version: z.number(),
  ts: z.string(),
  session_id: z.string(),
  turn_id: z.string().nullable(),
  tokens_before: z.number(),
  tokens_after: z.number(),
  compression_model: z.string().nullable(),
  compression_provider: z.string().nullable(),
  compression_prompt_tokens: z.number().optional(),
  compression_output_tokens: z.number().optional(),
});

const SerializedProviderSwitchRecordSchema = z.object({
  record_type: z.literal('provider_switch'),
  schema_version: z.number(),
  ts: z.string(),
  session_id: z.string(),
  turn_id: z.string().nullable(),
  from_provider: z.string().nullable(),
  to_provider: z.string(),
  from_model: z.string().nullable(),
  to_model: z.string().nullable(),
});

const SerializedModelSwitchRecordSchema = z.object({
  record_type: z.literal('model_switch'),
  schema_version: z.number(),
  ts: z.string(),
  session_id: z.string(),
  turn_id: z.string().nullable(),
  from_model: z.string().nullable(),
  to_model: z.string(),
  provider: z.string(),
});

const SerializedSessionResumeRecordSchema = z.object({
  record_type: z.literal('session_resume'),
  schema_version: z.number(),
  ts: z.string(),
  session_id: z.string(),
  turn_id: z.string().nullable(),
  resumed_session_id: z.string().nullable(),
  restored_history_items: z.number(),
  restored_tokens: z.number().nullable(),
});

const SerializedContextTruncationRecordSchema = z.object({
  record_type: z.literal('context_truncation'),
  schema_version: z.number(),
  ts: z.string(),
  session_id: z.string(),
  turn_id: z.string().nullable(),
  tokens_before: z.number(),
  tokens_after: z.number(),
  dropped_items: z.number(),
  reason: z.string().nullable(),
});

export const SerializedTokenUsageLifecycleRecordSchema = z.discriminatedUnion(
  'record_type',
  [
    SerializedCompressionRecordSchema,
    SerializedProviderSwitchRecordSchema,
    SerializedModelSwitchRecordSchema,
    SerializedSessionResumeRecordSchema,
    SerializedContextTruncationRecordSchema,
  ],
);

export type SerializedTokenUsageLifecycleRecord = z.infer<
  typeof SerializedTokenUsageLifecycleRecordSchema
>;

// ---------------------------------------------------------------------------
// Full log-record union
// ---------------------------------------------------------------------------

export const SerializedTokenUsageLogRecordSchema = z.discriminatedUnion(
  'record_type',
  [
    SerializedTokenUsageTurnRecordSchema,
    SerializedCompressionRecordSchema,
    SerializedProviderSwitchRecordSchema,
    SerializedModelSwitchRecordSchema,
    SerializedSessionResumeRecordSchema,
    SerializedContextTruncationRecordSchema,
  ],
);

export type SerializedTokenUsageLogRecord = z.infer<
  typeof SerializedTokenUsageLogRecordSchema
>;

/**
 * Backward-compatible alias. Existing consumers import this name from
 * `TokenUsageLogger.ts`; it is now an alias of the turn record type.
 */
export type SerializedTokenUsageRecord = SerializedTokenUsageTurnRecord;

// ---------------------------------------------------------------------------
// Tolerant reader
// ---------------------------------------------------------------------------

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Tolerant reader for token-usage log records.
 *
 * - A record with NO `schema_version` and NO `record_type` is normalised to
 *   `{ ...record, schema_version: 0, record_type: 'turn' }` — the legacy
 *   corpus must keep parsing.
 * - A record with `record_type` is validated against the matching schema.
 * - Anything that does not validate returns `null` (never throws).
 */
export function parseTokenUsageLogRecord(
  value: unknown,
): SerializedTokenUsageLogRecord | null {
  if (!isStringRecord(value)) return null;

  const hasSchemaVersion = 'schema_version' in value;
  const hasRecordType = 'record_type' in value;

  if (!hasSchemaVersion && !hasRecordType) {
    const normalized = { ...value, schema_version: 0, record_type: 'turn' };
    const result = SerializedTokenUsageTurnRecordSchema.safeParse(normalized);
    return result.success ? result.data : null;
  }

  const result = SerializedTokenUsageLogRecordSchema.safeParse(value);
  return result.success ? result.data : null;
}

// ---------------------------------------------------------------------------
// Input types (camelCase TS API)
// ---------------------------------------------------------------------------

/**
 * Join keys, request-shape buckets, tool attribution, and cache key captured
 * once per send attempt at the agents-layer send seam.  Attached to the
 * pending estimate so the actual-usage completion writes a single complete
 * record.  Cost and attempt fields are NOT here — they come from the
 * provider response via `TokenUsageActualInput`.
 */
export interface TokenUsageTurnContext {
  // AC-1 join keys
  sessionId?: string;
  turnId?: string | null;
  userTurn?: number | null;
  step?: number | null;
  runtimeId?: string;
  parentRuntimeId?: string | null;
  subagentName?: string | null;
  // AC-5 tool attribution
  toolCalls?: ReadonlyArray<{
    callId: string;
    toolName: string;
    resultTokens: number;
    wasTruncated: boolean;
  }>;
  newToolResultTokens?: number;
  carriedToolResultTokens?: number;
  // AC-6 request-shape provenance
  instructionsTokens?: number;
  toolsSchemaTokens?: number;
  historyTokens?: number;
  mediaTokens?: number;
  injectedTokens?: number;
  promptCacheKey?: string;
  prefixFingerprint?: string;
  prefixFingerprintChanged?: boolean | null;
}

/**
 * Actual-usage input for `recordActual`.  Widened with optional cost (AC-3)
 * and attempt (AC-4) fields.  Cost fields are omitted (not zero-filled) when
 * the provider did not report them.
 */
export interface TokenUsageActualInput {
  actualPromptTokens: number;
  cachedTokens: number;
  // AC-3 cost fields
  outputTokens?: number;
  reasoningTokens?: number;
  cacheWriteTokens?: number;
  cacheReadTokens?: number;
  toolTokens?: number;
  totalTokens?: number;
  // AC-4 attempt fields
  attemptIndex?: number;
  attemptOutcome?: TokenUsageAttemptOutcome;
  retryReason?: string;
  httpStatus?: number;
  backendProfile?: string;
}

// ---------------------------------------------------------------------------
// Lifecycle event input types
// ---------------------------------------------------------------------------

export interface TokenUsageCompressionEvent {
  type: 'compression';
  ts?: string;
  sessionId: string;
  turnId?: string | null;
  tokensBefore: number;
  tokensAfter: number;
  compressionModel?: string | null;
  compressionProvider?: string | null;
  compressionPromptTokens?: number;
  compressionOutputTokens?: number;
}

export interface TokenUsageProviderSwitchEvent {
  type: 'provider_switch';
  ts?: string;
  sessionId: string;
  turnId?: string | null;
  fromProvider?: string | null;
  toProvider: string;
  fromModel?: string | null;
  toModel?: string | null;
}

export interface TokenUsageModelSwitchEvent {
  type: 'model_switch';
  ts?: string;
  sessionId: string;
  turnId?: string | null;
  fromModel?: string | null;
  toModel: string;
  provider: string;
}

export interface TokenUsageSessionResumeEvent {
  type: 'session_resume';
  ts?: string;
  sessionId: string;
  turnId?: string | null;
  resumedSessionId?: string | null;
  restoredHistoryItems: number;
  restoredTokens?: number | null;
}

export interface TokenUsageContextTruncationEvent {
  type: 'context_truncation';
  ts?: string;
  sessionId: string;
  turnId?: string | null;
  tokensBefore: number;
  tokensAfter: number;
  droppedItems: number;
  reason?: string | null;
}

export type TokenUsageLifecycleEvent =
  | TokenUsageCompressionEvent
  | TokenUsageProviderSwitchEvent
  | TokenUsageModelSwitchEvent
  | TokenUsageSessionResumeEvent
  | TokenUsageContextTruncationEvent;
