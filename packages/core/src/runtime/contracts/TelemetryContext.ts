/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned structural telemetry context contract.
 *
 * Core telemetry uses TelemetryContext instead of ProviderTelemetryContext
 * from the providers package. Provider package maps ProviderTelemetryContext
 * to this core contract when emitting telemetry events.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode component-boundaries.md C-CB-07, lines 70-73
 */

/**
 * Structural telemetry context owned by core.
 *
 * Fields represent the telemetry data that core runtime consumes.
 * Provider package's ProviderTelemetryContext maps to these fields.
 *
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 */
export interface TelemetryContext {
  record?: (eventName: string, payload: Record<string, unknown>) => void;
  [key: string]: unknown;
  providerName?: string;
  modelId?: string;
  tokenUsage?: {
    input: number;
    output: number;
    cache?: number;
    tool?: number;
    thought?: number;
    total: number;
  };
  latencyMs?: number;
  timestamp?: number;
}
