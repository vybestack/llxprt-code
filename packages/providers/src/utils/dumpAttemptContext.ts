/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export const DUMP_ATTEMPT_CONTEXT_KEY = '__llxprtDumpAttemptContext';

export type DumpAttemptOutcome = 'refusal' | 'paired-success' | 'success';

export interface DumpAttemptContext {
  readonly promptId: string;
  readonly attemptIndex: number;
  readonly runtimeId: string;
  readonly pairedSuccess: boolean;
  retentionLimits?: { readonly maxBytes: number; readonly maxAgeDays: number };
  dumpBaseId?: string;
  recordDump(outcome: DumpAttemptOutcome, baseId: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDumpAttemptContext(value: unknown): value is DumpAttemptContext {
  if (!isRecord(value)) return false;
  if (typeof value['promptId'] !== 'string') return false;
  if (typeof value['attemptIndex'] !== 'number') return false;
  if (typeof value['runtimeId'] !== 'string') return false;
  if (typeof value['pairedSuccess'] !== 'boolean') return false;
  return typeof value['recordDump'] === 'function';
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function resolveDumpRetentionLimits(
  ephemerals: Readonly<Record<string, unknown>> | undefined,
): { readonly maxBytes: number; readonly maxAgeDays: number } | undefined {
  const maxBytes = ephemerals?.['dump-retention-max-bytes'];
  const maxAgeDays = ephemerals?.['dump-retention-max-age-days'];
  if (maxBytes === undefined && maxAgeDays === undefined) return undefined;
  if (!isPositiveSafeInteger(maxBytes) || !isPositiveFiniteNumber(maxAgeDays)) {
    throw new TypeError('Invalid dump retention limits in provider invocation');
  }
  return { maxBytes, maxAgeDays };
}

export function readDumpAttemptContext(
  metadata: Readonly<Record<string, unknown>> | undefined,
  ephemerals?: Readonly<Record<string, unknown>>,
): DumpAttemptContext | undefined {
  const retentionLimits = resolveDumpRetentionLimits(ephemerals);
  const value = metadata?.[DUMP_ATTEMPT_CONTEXT_KEY];
  if (!isDumpAttemptContext(value)) return undefined;
  return retentionLimits === undefined ? value : { ...value, retentionLimits };
}

export function dumpAttemptResultContent(
  context: DumpAttemptContext | undefined,
): readonly IContent[] {
  return context?.dumpBaseId === undefined
    ? []
    : [
        {
          speaker: 'ai',
          blocks: [],
          metadata: { dumpBaseId: context.dumpBaseId },
        },
      ];
}
