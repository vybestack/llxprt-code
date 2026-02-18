/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20250218-HOOKSYSTEM.P06
 * @requirement DELTA-HBUS-001
 *
 * MessageBus contracts for hook execution. These interfaces define the
 * typed contract for all bus-mediated hook invocations.
 */

import type { HookEventName } from './types.js';
import type { AggregatedHookResult } from './hookAggregator.js';

/**
 * Request payload published to 'HOOK_EXECUTION_REQUEST' channel.
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P06
 * @requirement DELTA-HBUS-001
 */
export interface HookExecutionRequest {
  /** The hook event to fire (e.g., BeforeTool, AfterModel) */
  eventName: HookEventName;
  /** Event-specific input payload */
  input: Record<string, unknown>;
  /** Correlation ID for request/response pairing. Generated if not provided. */
  correlationId?: string;
}

/**
 * Response payload published to 'HOOK_EXECUTION_RESPONSE' channel.
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P06
 * @requirement DELTA-HBUS-001, DELTA-HEVT-002
 */
export interface HookExecutionResponse {
  /** Echoes the correlationId from the request */
  correlationId: string;
  /** Whether hook execution succeeded */
  success: boolean;
  /** The aggregated hook result on success */
  output?: AggregatedHookResult;
  /** Error details on failure */
  error?: {
    code?: string;
    message: string;
    details?: unknown;
  };
}
