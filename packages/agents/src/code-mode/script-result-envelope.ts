/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The one JSON value `execute_tool_script` hands to the model (issue #4084):
 * the outcome, the call accounting and the logs. The guest value is held to
 * `code-mode-max-result-bytes` by the runtime. This module then fits the whole
 * envelope and provider-visible wrapper to the call's output budget. Admission
 * caps calls to the accounting capacity of that budget, so a result can become
 * RESULT_TOO_LARGE without losing completed-call records.
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

const SCRIPT_TOOL_NAME = 'execute_tool_script';
const MINIMUM_FAILURE_MESSAGE =
  'Increase tool-output-max-tokens to preserve complete script results and call accounting.';

function providerWireText(
  output: string,
  failureMessage: string | undefined,
): string {
  return [
    'status:',
    failureMessage === undefined ? 'success' : 'error',
    '',
    'toolName:',
    SCRIPT_TOOL_NAME,
    '',
    'error:',
    failureMessage ?? '',
    '',
    'output:',
    output,
  ].join('\n');
}

function fitsProviderBudget(
  output: string,
  failureMessage: string | undefined,
  limit: ParsedToolOutputMaxTokens,
): boolean {
  return (
    limit.kind === 'disabled' ||
    estimateTokens(providerWireText(output, failureMessage)) <=
      getEffectiveTokenLimit(limit.maxTokens)
  );
}

/**
 * Validate the configured limit against a failure carrying the maximum
 * bounded call ledger before any nested operation is admitted.
 */
function minimumAccountingFits(
  limit: ParsedToolOutputMaxTokens,
  callCount: number,
  callableTools: readonly string[],
): boolean {
  if (limit.kind === 'disabled') return true;
  const longestTool = callableTools.reduce(
    (longest, tool) => (tool.length > longest.length ? tool : longest),
    '',
  );
  const completedCalls = Array.from({ length: callCount }, () => ({
    tool: longestTool,
    status: 'approval_required',
  }));
  const accounting = {
    callCount,
    partial: false,
    completedCalls,
    logs: [],
  };
  const minimumFailure = {
    ok: false,
    error: { code: 'RESULT_TOO_LARGE', message: MINIMUM_FAILURE_MESSAGE },
    ...accounting,
  };
  const hookFailure = {
    ok: false,
    error: {
      code: 'RESULT_TOO_LARGE',
      message:
        'Hook output exceeded the model output budget; hook text is recorded as omitted.',
    },
    ...accounting,
    hookOutput: {
      omitted: true,
      reason: 'output budget exceeded',
      characters: Number.MAX_SAFE_INTEGER,
    },
  };
  return (
    fitsProviderBudget(
      JSON.stringify(minimumFailure),
      `Script failed with RESULT_TOO_LARGE: ${MINIMUM_FAILURE_MESSAGE}`,
      limit,
    ) &&
    fitsProviderBudget(
      JSON.stringify(hookFailure),
      `Script failed with RESULT_TOO_LARGE: ${hookFailure.error.message}`,
      limit,
    )
  );
}

/** Limits admitted calls to the ledger size the configured output can carry. */
export function outputBudgetCallLimit(
  limit: ParsedToolOutputMaxTokens,
  configuredMaxCalls: number,
  callableTools: readonly string[],
): number {
  for (let callCount = configuredMaxCalls; callCount > 0; callCount--) {
    if (minimumAccountingFits(limit, callCount, callableTools))
      return callCount;
  }
  return 0;
}

/** Tests a final script envelope against the full provider-visible wrapper. */
export function scriptEnvelopeFitsProviderBudget(
  envelope: ScriptEnvelope,
  failureMessage: string | undefined,
  limit: ParsedToolOutputMaxTokens,
): boolean {
  return fitsProviderBudget(JSON.stringify(envelope), failureMessage, limit);
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
 * Ends a run whose envelope or provider wrapper exceeds the model output
 * budget with RESULT_TOO_LARGE, keeping its call accounting and leaving out
 * the value and logs. Admission already bounded the call ledger to fit this
 * failure representation.
 */
export function fitModelOutputBudget(
  report: CodeModeRunReport,
  limit: ParsedToolOutputMaxTokens,
): CodeModeRunReport {
  if (limit.kind === 'disabled') return report;
  const envelope = scriptEnvelope(report);
  const failureMessage = report.result.ok
    ? undefined
    : `Script failed with ${report.result.error.code}: ${report.result.error.message}`;
  if (scriptEnvelopeFitsProviderBudget(envelope, failureMessage, limit))
    return report;
  return {
    ...report,
    result: {
      ok: false,
      error: {
        code: 'RESULT_TOO_LARGE',
        message:
          'The script result exceeded the configured tool output budget.',
      },
      callCount: report.result.callCount,
      logs: [],
    },
  };
}
