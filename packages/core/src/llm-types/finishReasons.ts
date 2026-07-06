/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Neutral finish-reason type layer — provider-agnostic canonical reasons
 * plus mapping helpers for Gemini, OpenAI, and Anthropic raw stop strings.
 *
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001
 * @pseudocode lines 10-26
 */

/** @plan PLAN-20260702-LLMTYPES.P03 @requirement REQ-001.1 @pseudocode line 10 */
export type CanonicalFinishReason =
  | 'stop'
  | 'max_tokens'
  | 'tool_calls'
  | 'safety'
  | 'refusal'
  | 'error'
  | 'other';

/** @plan PLAN-20260702-LLMTYPES.P03 @requirement REQ-001.5 @pseudocode line 11 */
export interface FinishInfo {
  finishReason: CanonicalFinishReason;
  rawStopReason: string;
}

/**
 * Compile-time-synchronized array of all canonical finish reasons. The
 * `satisfies readonly CanonicalFinishReason[]` ensures every element is a
 * valid union member, and the exhaustiveness assertion below ensures every
 * union member is present in the array. If a variant is added or removed,
 * TypeScript flags the mismatch at compile time.
 */
export const CANONICAL_FINISH_REASONS = [
  'stop',
  'max_tokens',
  'tool_calls',
  'safety',
  'refusal',
  'error',
  'other',
] as const satisfies readonly CanonicalFinishReason[];

// Compile-time exhaustiveness check: if CanonicalFinishReason has a member
// not present in CANONICAL_FINISH_REASONS, this type is `never` → assignment
// of `true` fails to compile. Zero runtime cost.
type _AssertAllCovered = [
  Exclude<CanonicalFinishReason, (typeof CANONICAL_FINISH_REASONS)[number]>,
] extends [never]
  ? true
  : never;
const _assertAllCovered: _AssertAllCovered = true;
void _assertAllCovered;

const CANONICAL_SET: ReadonlySet<string> = new Set<string>(
  CANONICAL_FINISH_REASONS,
);

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001.2
 * @pseudocode lines 12-16
 */
export const GEMINI_FINISH_MAP: Readonly<
  Record<string, CanonicalFinishReason>
> = {
  STOP: 'stop',
  MAX_TOKENS: 'max_tokens',
  SAFETY: 'safety',
  IMAGE_SAFETY: 'safety',
  RECITATION: 'safety',
  LANGUAGE: 'other',
  BLOCKLIST: 'safety',
  PROHIBITED_CONTENT: 'safety',
  SPII: 'safety',
  MALFORMED_FUNCTION_CALL: 'error',
  UNEXPECTED_TOOL_CALL: 'error',
  OTHER: 'other',
  IMAGE_PROHIBITED_CONTENT: 'safety',
  NO_IMAGE: 'other',
  FINISH_REASON_UNSPECIFIED: 'other',
};

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001.3
 * @pseudocode lines 19-20
 */
export const OPENAI_FINISH_MAP: Readonly<
  Record<string, CanonicalFinishReason>
> = {
  stop: 'stop',
  length: 'max_tokens',
  tool_calls: 'tool_calls',
  function_call: 'tool_calls',
  content_filter: 'safety',
  refusal: 'refusal',
};

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001.4
 * @pseudocode lines 22-23
 */
export const ANTHROPIC_STOP_MAP: Readonly<
  Record<string, CanonicalFinishReason>
> = {
  end_turn: 'stop',
  max_tokens: 'max_tokens',
  tool_use: 'tool_calls',
  refusal: 'refusal',
  stop_sequence: 'stop',
};

function mapWithTable(
  raw: string,
  table: Readonly<Record<string, CanonicalFinishReason>>,
): FinishInfo {
  // Guard against nullish runtime values (JS interop / any-typed callers).
  // Without this, null/undefined are coerced to the strings "null"/"undefined".
  // The nullishToEmpty helper routes through unknown so the TS-aware lint rule
  // does not flag the nullish check as unnecessary on a string-typed param.
  const key = nullishToEmpty(raw);
  const mapped = Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;
  return {
    // Unmapped provider strings default to 'other' (benign unknown). Callers
    // needing diagnostics should inspect rawStopReason rather than relying on
    // finishReason alone.
    finishReason: mapped ?? 'other',
    rawStopReason: key,
  };
}

function nullishToEmpty(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return typeof value === 'string' ? value : String(value);
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001.2, REQ-001.5
 * @pseudocode lines 17-18
 */
export function mapGeminiFinishReason(raw: string): FinishInfo {
  return mapWithTable(raw, GEMINI_FINISH_MAP);
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001.3, REQ-001.5
 * @pseudocode line 21
 */
export function mapOpenAIFinishReason(raw: string): FinishInfo {
  return mapWithTable(raw, OPENAI_FINISH_MAP);
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001.4, REQ-001.5
 * @pseudocode line 24
 */
export function mapAnthropicStopReason(raw: string): FinishInfo {
  return mapWithTable(raw, ANTHROPIC_STOP_MAP);
}

/**
 * @plan PLAN-20260702-LLMTYPES.P03
 * @requirement REQ-001
 * @pseudocode lines 25-26
 */
export function isCanonicalFinishReason(
  value: unknown,
): value is CanonicalFinishReason {
  return typeof value === 'string' && CANONICAL_SET.has(value);
}
