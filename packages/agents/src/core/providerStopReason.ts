/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Candidate } from '@google/genai';

/**
 * Repo-owned carrier for the raw provider stop reason (e.g. Anthropic
 * `stop_reason: 'refusal'`, `'end_turn'`) on a response candidate.
 *
 * WHY a custom field: the raw provider stop reason must travel from
 * MessageConverter (which sees IContent metadata) to Turn (which sees only
 * GenerateContentResponse). Piggy-backing on the SDK's own
 * `candidate.finishMessage` field was rejected because that field's
 * documented purpose is a human-readable finish description — a native
 * Gemini response could legitimately populate it with descriptive text that
 * would then be misinterpreted as a machine stop-reason signal. The SDK will
 * never populate `providerStopReason`, so collisions are impossible.
 *
 * @issue:2329
 */
export interface CandidateWithProviderStopReason extends Candidate {
  providerStopReason?: string;
}

/**
 * Records the raw provider stop reason on a candidate. This is the single
 * controlled widening point for the repo-owned field; all writers must go
 * through this helper.
 */
export function setProviderStopReason(
  candidate: Candidate,
  stopReason: string,
): void {
  (candidate as CandidateWithProviderStopReason).providerStopReason =
    stopReason;
}

/**
 * Reads the raw provider stop reason from a candidate, returning undefined
 * when absent or not a string (e.g. on native SDK responses that never
 * carry the field).
 */
export function getProviderStopReason(
  candidate: Candidate | undefined,
): string | undefined {
  if (candidate === undefined) {
    return undefined;
  }
  const value = (candidate as CandidateWithProviderStopReason)
    .providerStopReason;
  return typeof value === 'string' ? value : undefined;
}
