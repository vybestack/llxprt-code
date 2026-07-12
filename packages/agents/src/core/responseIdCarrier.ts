/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentResponse } from '@google/genai';

/**
 * Repo-owned carrier for the provider response id (e.g. OpenAI Responses
 * `response.id`) and the server-side-stored flag on a synthetic
 * GenerateContentResponse.
 *
 * WHY a custom field: the response id must travel from the provider stream
 * (which emits it on IContent metadata) through the Gemini-shaped
 * intermediate and back to history (as `IContent.metadata.id`). The SDK's
 * `GenerateContentResponse` already exposes a native `responseId` field
 * (populated by Gemini-native providers), so piggy-backing on that field
 * would cause collisions — a Gemini-native chunk could be mistaken for the
 * OpenAI `response.id` and persisted into `metadata.id` /
 * `previous_response_id`. The field name `providerResponseId` is
 * repo-owned and the SDK will never populate it, so collisions are
 * impossible.
 *
 * @issue:207
 */
export interface ResponseWithProviderResponseId
  extends GenerateContentResponse {
  providerResponseId?: string;
  providerResponsesStored?: boolean;
}

/**
 * Records the provider response id (and optionally the stored flag) on a
 * response. This is the single controlled widening point for the repo-owned
 * fields; all writers must go through this helper.
 */
export function setResponseId(
  response: GenerateContentResponse | null | undefined,
  id: string,
  stored?: boolean,
): void {
  if (response === undefined || response === null) return;
  if (typeof id !== 'string' || id.length === 0) return;
  const widened = response as ResponseWithProviderResponseId;
  widened.providerResponseId = id;
  if (stored !== undefined) {
    widened.providerResponsesStored = stored;
  }
}

/**
 * Reads the provider response id from a response, returning undefined when
 * absent or not a string (e.g. on native SDK responses that never carry
 * the field).
 */
export function getResponseId(
  response: GenerateContentResponse | null | undefined,
): string | undefined {
  if (response === undefined || response === null) {
    return undefined;
  }
  const value = (response as ResponseWithProviderResponseId).providerResponseId;
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads the provider-responses-stored flag from a response, returning
 * undefined when absent. When true, the prior turn was persisted server-side
 * (store=true) and is safe to reference via previous_response_id.
 */
export function getResponsesStored(
  response: GenerateContentResponse | null | undefined,
): boolean | undefined {
  if (response === undefined || response === null) {
    return undefined;
  }
  const value = (response as ResponseWithProviderResponseId)
    .providerResponsesStored;
  return typeof value === 'boolean' ? value : undefined;
}
