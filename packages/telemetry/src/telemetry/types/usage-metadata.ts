/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider-neutral structural type for model response usage metadata.
 *
 * The telemetry package is a leaf workspace package and cannot depend on
 * core's llm-types layer, so the minimal shape needed by telemetry event
 * logging is defined here. Field names are the neutral internal scheme
 * (input/output/cached/thinking/toolUseInput); provider SDK shapes with
 * vendor-specific field names must be mapped before constructing events.
 */

/**
 * Usage metadata for a model response, capturing token counts consumed
 * during generation.
 *
 * Only the fields consumed by telemetry event logging are modeled.
 */
export interface UsageMetadata {
  inputTokenCount?: number;
  outputTokenCount?: number;
  totalTokenCount?: number;
  cachedTokenCount?: number;
  thinkingTokenCount?: number;
  toolUseInputTokenCount?: number;
  cachedTokensDetails?: Array<Record<string, unknown>>;
  outputTokensDetails?: Array<Record<string, unknown>>;
  inputTokensDetails?: Array<Record<string, unknown>>;
  toolUseInputTokensDetails?: Array<Record<string, unknown>>;
  trafficType?: string;
}
