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
 * logging is defined here. Concrete provider SDK usage-metadata objects
 * are structurally assignable to this interface without a runtime
 * dependency on any specific provider SDK.
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
