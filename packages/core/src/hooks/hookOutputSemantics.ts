/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AggregatedHookResult } from './hookAggregator.js';

/**
 * Processed hook result with common-output semantics.
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P12
 * @requirement DELTA-HRUN-004
 */
export interface ProcessedHookResult {
  aggregated: AggregatedHookResult;
  shouldStop: boolean;
  stopReason: string | undefined;
  systemMessage: string | undefined;
  suppressOutput: boolean;
}

/**
 * Process common hook output fields (shouldStop, systemMessage, suppressOutput).
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P12, PLAN-20250218-HOOKSYSTEM.P14
 * @requirement DELTA-HRUN-001, DELTA-HRUN-004
 */
export function processCommonHookOutput(
  aggregated: AggregatedHookResult,
): ProcessedHookResult {
  let shouldStop = false;
  let stopReason: string | undefined = undefined;
  let systemMessage: string | undefined = undefined;
  let suppressOutput = false;

  // Pass 1 - stop intent (first wins): triggered by continue === false (upstream parity)
  for (const hookOutput of aggregated.allOutputs) {
    if (hookOutput.continue === false) {
      shouldStop = true;
      // Use effective reason: reason, stopReason, or fallback
      stopReason =
        normalizeStopReason(hookOutput.reason) ??
        normalizeStopReason(hookOutput.stopReason) ??
        'Hook requested stop';
      break;
    }
  }

  // Pass 2 - systemMessage and suppressOutput (first non-empty systemMessage wins)
  for (const hookOutput of aggregated.allOutputs) {
    if (hookOutput.systemMessage != null && hookOutput.systemMessage !== '') {
      systemMessage = hookOutput.systemMessage;
      if (hookOutput.suppressOutput === true) {
        suppressOutput = true;
      }
      break;
    }
  }

  return {
    aggregated,
    shouldStop,
    stopReason,
    systemMessage,
    suppressOutput,
  };
}

/**
 * Normalize a raw stopReason value to a trimmed string or undefined.
 *
 * @plan PLAN-20250218-HOOKSYSTEM.P14
 * @requirement DELTA-HRUN-002
 */
function normalizeStopReason(rawReason: unknown): string | undefined {
  if (rawReason === undefined || rawReason === null) return undefined;
  if (typeof rawReason === 'string') {
    const trimmed = rawReason.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  return String(rawReason);
}
