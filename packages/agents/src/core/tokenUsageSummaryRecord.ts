/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SerializedTokenUsageTurnRecord } from './tokenUsageRecords.js';

/**
 * Project a full (debug-level) turn record onto the `summary` level (#4068).
 *
 * The summary keeps one scalar line per model request: identity and lineage,
 * the attempt's finish reasons, provider/model/protocol, provider-reported
 * usage, the estimate and its
 * family, timing, the fixed instruction-plus-tool-schema overhead, and the
 * new-versus-carried tool-result totals. Arrays (`tool_calls`), the
 * per-component prompt split, the prefix fingerprint and the estimator
 * internals are debug-only.
 *
 * Fields the full record omits stay `undefined` here and are dropped by
 * `JSON.stringify`, so a provider that does not report `reasoning_tokens` (or
 * a request with no timing) produces no key at all — never a zero.
 */
export function toSummaryTurnRecord(
  full: SerializedTokenUsageTurnRecord,
): SerializedTokenUsageTurnRecord {
  return {
    record_type: full.record_type,
    schema_version: full.schema_version,
    ts: full.ts,
    session_id: full.session_id,
    turn_id: full.turn_id,
    runtime_id: full.runtime_id,
    parent_runtime_id: full.parent_runtime_id,
    subagent_name: full.subagent_name,
    prompt_id: full.prompt_id,
    attempt_index: full.attempt_index,
    attempt_outcome: full.attempt_outcome,
    // #4036 asked for refusals to be logged with the provider's stop reason;
    // #4068's field list predates that, so the two scalar finish reasons stay
    // in the summary rather than regressing the default log.
    finish_reason: full.finish_reason,
    raw_stop_reason: full.raw_stop_reason,
    provider: full.provider,
    model: full.model,
    protocol: full.protocol,
    actual_prompt_tokens: full.actual_prompt_tokens,
    cached_tokens: full.cached_tokens,
    cache_write_tokens: full.cache_write_tokens,
    output_tokens: full.output_tokens,
    reasoning_tokens: full.reasoning_tokens,
    estimated_tokens: full.estimated_tokens,
    estimator_family: full.estimator_family,
    stateful_parent_used: full.stateful_parent_used,
    ttft_ms: full.ttft_ms,
    provider_request_ms: full.provider_request_ms,
    generation_ms: full.generation_ms,
    timing_source: full.timing_source,
    fixed_tokens: full.fixed_tokens,
    new_tool_result_count: full.new_tool_result_count,
    new_tool_result_tokens: full.new_tool_result_tokens,
    carried_tool_result_tokens: full.carried_tool_result_tokens,
  };
}
