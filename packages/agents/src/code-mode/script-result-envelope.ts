/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one JSON value `execute_tool_script` hands to the model (issue #4084):
 * the outcome, the call accounting and the logs. The script result path owns
 * its size: the guest value is held to `code-mode-max-result-bytes` by the
 * runtime, and the whole envelope to this call's model output token budget
 * here. A run whose envelope does not fit ends as RESULT_TOO_LARGE with its
 * accounting, so the model never gets clipped JSON or the ordinary
 * token-limit guidance in its place.
 */

import {
  estimateTokens,
  getEffectiveTokenLimit,
} from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import type { ParsedToolOutputMaxTokens } from '@vybestack/llxprt-code-tools/utils/toolOutputMaxTokens.js';
import type { NestedCallStatus } from './nested-call-outcome.js';
import type { CodeModeRunResult, JsonValue } from './runtime-contract.js';

export interface NestedCallRecord {
  readonly tool: string;
  readonly status: NestedCallStatus;
}

export interface CodeModeRunReport {
  readonly result: CodeModeRunResult;
  readonly completedCalls: readonly NestedCallRecord[];
  /** True when any result delivered to the guest was partial. */
  readonly partial: boolean;
}

export interface ScriptEnvelope {
  readonly [key: string]: JsonValue;
}

export function scriptEnvelope(report: CodeModeRunReport): ScriptEnvelope {
  const { result, completedCalls, partial } = report;
  const outcome: ScriptEnvelope = result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: { ...result.error } };
  return {
    ...outcome,
    callCount: result.callCount,
    partial,
    completedCalls: completedCalls.map(({ tool, status }) => ({
      tool,
      status,
    })),
    logs: [...result.logs],
  };
}

/**
 * Ends a run whose envelope is over the call's model output budget with
 * RESULT_TOO_LARGE, keeping its call accounting and leaving out the value and
 * logs. The rejection itself is bounded by the call limit (one short entry
 * per call) and is delivered whole even under a budget smaller than it.
 */
export function fitModelOutputBudget(
  report: CodeModeRunReport,
  limit: ParsedToolOutputMaxTokens,
): CodeModeRunReport {
  if (limit.kind === 'disabled') return report;
  const budget = getEffectiveTokenLimit(limit.maxTokens);
  const tokens = estimateTokens(JSON.stringify(scriptEnvelope(report)));
  if (tokens <= budget) return report;
  return {
    ...report,
    result: {
      ok: false,
      error: {
        code: 'RESULT_TOO_LARGE',
        message: `The script result is ${tokens} tokens, over the ${budget}-token tool output budget of this call (tool-output-max-tokens). Return less: counts, a summary, or one page at a time.`,
      },
      callCount: report.result.callCount,
      logs: [],
    },
  };
}
