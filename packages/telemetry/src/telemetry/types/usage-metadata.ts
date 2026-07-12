/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local neutral structural type for model response usage metadata.
 *
 * The telemetry package is a leaf package and cannot depend on core's
 * llm-types layer, so the minimal shape needed by telemetry event logging
 * is replicated here. This is structurally compatible with (but does not
 * import) {@link @google/genai} `GenerateContentResponseUsageMetadata`.
 */

/**
 * Structural equivalent of
 * {@link @google/genai} `GenerateContentResponseUsageMetadata`.
 *
 * Only the fields consumed by telemetry event logging are modeled.
 */
export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  cacheTokensDetails?: Array<Record<string, unknown>>;
  candidatesTokensDetails?: Array<Record<string, unknown>>;
  promptTokensDetails?: Array<Record<string, unknown>>;
  toolUsePromptTokensDetails?: Array<Record<string, unknown>>;
  trafficType?: string;
}
