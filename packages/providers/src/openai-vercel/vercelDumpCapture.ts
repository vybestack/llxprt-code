/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mapFinishReason } from '../openai/finishReasonMapping.js';
import type { DumpAttemptContext } from '../utils/dumpAttemptContext.js';
import { bestEffortDump } from '../utils/dumpSDKContext.js';
import type {
  DumpMode,
  DumpRequest,
  DumpResponse,
} from '../utils/dumpContext.js';
import {
  dumpRequestContext,
  dumpResponseContext,
} from '../utils/dumpContext.js';

export interface VercelDumpCapture {
  readonly mode: DumpMode;
  readonly attemptContext?: DumpAttemptContext;
  readonly retentionLimits?: {
    readonly maxBytes: number;
    readonly maxAgeDays: number;
  };
  readonly request: DumpRequest;
  readonly providerName: string;
  readonly responseHeaders?: Record<string, string>;
}

function outcomeForReason(
  finishReason: string | undefined,
): 'refusal' | 'success' | undefined {
  if (finishReason === undefined) return undefined;
  const reason = mapFinishReason(finishReason).finishReason;
  if (reason === 'refusal') return 'refusal';
  if (reason === 'stop' || reason === 'tool_calls' || reason === 'max_tokens')
    return 'success';
  return undefined;
}

function dumpOutcomeForAttempt(
  mode: DumpMode,
  outcome: 'refusal' | 'success' | undefined,
  attempt: DumpAttemptContext | undefined,
): 'refusal' | 'paired-success' | 'success' | undefined {
  if (mode === 'on') return outcome === 'refusal' ? 'refusal' : 'success';
  if (mode !== 'error') return undefined;
  if (outcome === 'refusal') return 'refusal';
  if (outcome === 'success' && attempt?.pairedSuccess === true)
    return 'paired-success';
  return undefined;
}

export async function writeVercelDumpPair(
  capture: VercelDumpCapture,
  response: DumpResponse,
  finishReason: string | undefined,
): Promise<void> {
  const attempt = capture.attemptContext;
  const dumpOutcome = dumpOutcomeForAttempt(
    capture.mode,
    outcomeForReason(finishReason),
    attempt,
  );
  if (dumpOutcome === undefined) return;

  const correlation =
    attempt === undefined && capture.retentionLimits === undefined
      ? undefined
      : {
          promptId: attempt?.promptId ?? null,
          attemptIndex: attempt?.attemptIndex ?? null,
          runtimeId: attempt?.runtimeId ?? null,
          retentionLimits: attempt?.retentionLimits ?? capture.retentionLimits,
          outcome: dumpOutcome,
        };
  const request = await bestEffortDump(
    'outcome-request',
    capture.providerName,
    () =>
      dumpRequestContext(
        capture.request,
        capture.providerName,
        undefined,
        undefined,
        {},
        correlation,
        true,
      ),
  );
  if (request === undefined) return;
  const result = await bestEffortDump(
    'outcome-response',
    capture.providerName,
    () =>
      dumpResponseContext(
        request.baseId,
        {
          ...response,
          ...(capture.responseHeaders === undefined
            ? {}
            : { headers: capture.responseHeaders }),
        },
        capture.providerName,
        {},
        correlation,
      ),
  );
  if (result?.retained === true && attempt !== undefined)
    attempt.recordDump(dumpOutcome, request.baseId);
}
