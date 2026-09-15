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
 * plus the temporary Gemini mapping used by the v1 hook adapter.
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
 * @requirement REQ-001.2, REQ-001.5
 * @pseudocode lines 17-18
 */
export function mapGeminiFinishReason(
  raw: string | null | undefined,
): FinishInfo {
  const rawStopReason = raw ?? '';
  return {
    finishReason: Object.prototype.hasOwnProperty.call(
      GEMINI_FINISH_MAP,
      rawStopReason,
    )
      ? GEMINI_FINISH_MAP[rawStopReason]
      : 'other',
    rawStopReason,
  };
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
