/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentResponse } from '@google/genai';

/**
 * Repo-owned carrier for the provider response id (e.g. OpenAI Responses
 * `response.id`) on a synthetic GenerateContentResponse.
 *
 * WHY a custom field: the response id must travel from the provider stream
 * (which emits it on IContent metadata) through the Gemini-shaped
 * intermediate and back to history (as `IContent.metadata.id`). Piggy-backing
 * on an SDK field was rejected because there is no native Gemini field whose
 * documented purpose is "the provider's response identifier" — collisions
 * with real Gemini data would be possible. The SDK will never populate
 * `responseId`, so collisions are impossible.
 *
 * @issue:207
 */
export interface ResponseWithResponseId extends GenerateContentResponse {
  responseId?: string;
}

/**
 * Records the provider response id on a response. This is the single
 * controlled widening point for the repo-owned field; all writers must go
 * through this helper.
 */
export function setResponseId(
  response: GenerateContentResponse,
  id: string,
): void {
  (response as ResponseWithResponseId).responseId = id;
}

/**
 * Reads the provider response id from a response, returning undefined when
 * absent or not a string (e.g. on native SDK responses that never carry
 * the field).
 */
export function getResponseId(
  response: GenerateContentResponse | undefined,
): string | undefined {
  if (response === undefined) {
    return undefined;
  }
  const value = (response as ResponseWithResponseId).responseId;
  return typeof value === 'string' ? value : undefined;
}
