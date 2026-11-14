/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Turns a nested call's terminal scheduler state into what the script sees
 * (issue #4084). Ordinary tool failures become `{ ok: false }` results the
 * script can handle; a policy denial, a refused approval or a headless
 * approval requirement ends the whole run, so the guest cannot catch it.
 */

import type { CompletedToolCall } from '@vybestack/llxprt-code-core/scheduler/types.js';
import {
  ToolApprovalRequiredError,
  type ToolResult,
  type ToolStructuredOutput,
} from '@vybestack/llxprt-code-tools';
import { ToolErrorType } from '@vybestack/llxprt-code-tools/types/tool-error.js';
import {
  ScriptRunTermination,
  type JsonValue,
  type ScriptToolResult,
} from './runtime-contract.js';

/** Host-side record of one nested call, reported in the run summary. */
export type NestedCallStatus =
  | 'ok'
  | 'failed'
  | 'denied'
  | 'approval_required'
  | 'cancelled';

export type NestedCallOutcome =
  | {
      readonly kind: 'result';
      readonly status: NestedCallStatus;
      readonly result: ScriptToolResult;
    }
  | {
      readonly kind: 'termination';
      readonly status: NestedCallStatus;
      readonly termination: ScriptRunTermination;
    };

export const CANCELLED_RESULT: ScriptToolResult = Object.freeze({
  ok: false,
  error: Object.freeze({
    code: 'CANCELLED',
    message: 'The nested call was cancelled because the script run ended.',
  }),
});

function failure(code: string, message: string): ScriptToolResult {
  return { ok: false, error: { code, message } };
}

function contentText(content: ToolResult['llmContent']): string | undefined {
  const parts = Array.isArray(content) ? content : [content];
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') texts.push(part);
    else if (
      typeof part.text === 'string' &&
      part.inlineData === undefined &&
      part.fileData === undefined
    )
      texts.push(part.text);
    else return undefined;
  }
  return texts.join('');
}

function programmaticValue(
  result: ToolResult,
): { readonly value: JsonValue } | undefined {
  const structured: ToolStructuredOutput | undefined = result.structuredOutput;
  if (structured !== undefined) return { value: structured };
  const text = contentText(result.llmContent);
  return text === undefined ? undefined : { value: { text } };
}

/** Converts a delivered post-hook result into the guest's view of it. */
export function toScriptResult(result: ToolResult): ScriptToolResult {
  if (result.error !== undefined)
    return failure(
      (result.error.type ?? ToolErrorType.EXECUTION_FAILED).toUpperCase(),
      result.error.message,
    );
  const programmatic = programmaticValue(result);
  if (programmatic === undefined)
    return failure(
      'UNSUPPORTED_CONTENT',
      'The tool returned media or other non-text content, which scripts cannot receive.',
    );
  return {
    ok: true,
    value: programmatic.value,
    completeness: result.completeness ?? 'unknown',
  };
}

function erroredOutcome(
  call: Extract<CompletedToolCall, { status: 'error' }>,
  delivered: ToolResult | undefined,
): NestedCallOutcome {
  const { error, errorType } = call.response;
  const message = error?.message ?? `Tool ${call.request.name} failed.`;
  // Covers the scheduler's own headless refusal and tools (shell) that
  // refuse to prompt in a non-interactive session.
  if (error instanceof ToolApprovalRequiredError)
    return {
      kind: 'termination',
      status: 'approval_required',
      termination: new ScriptRunTermination('APPROVAL_REQUIRED', message),
    };
  if (errorType === ToolErrorType.POLICY_VIOLATION)
    return {
      kind: 'termination',
      status: 'denied',
      termination: new ScriptRunTermination('POLICY_DENIED', message),
    };
  return {
    kind: 'result',
    status: 'failed',
    result:
      delivered === undefined
        ? failure(
            (errorType ?? ToolErrorType.EXECUTION_FAILED).toUpperCase(),
            message,
          )
        : toScriptResult(delivered),
  };
}

/**
 * Classifies a terminal nested call. `aborted` means the run itself ended
 * while the call was in flight; the call's own status no longer matters.
 */
export function classifyNestedCall(
  call: CompletedToolCall,
  delivered: ToolResult | undefined,
  aborted: boolean,
): NestedCallOutcome {
  if (aborted)
    return { kind: 'result', status: 'cancelled', result: CANCELLED_RESULT };
  if (call.status === 'error') return erroredOutcome(call, delivered);
  if (call.status === 'cancelled')
    return {
      kind: 'termination',
      status: 'denied',
      termination: new ScriptRunTermination(
        'APPROVAL_DENIED',
        `The user did not allow ${call.request.name}.`,
      ),
    };
  if (delivered === undefined)
    throw new Error(
      `Nested call ${call.request.callId} succeeded without a delivered result.`,
    );
  const result = toScriptResult(delivered);
  return { kind: 'result', status: result.ok ? 'ok' : 'failed', result };
}
