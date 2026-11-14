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

export function readDumpAttemptContext(
  metadata: Readonly<Record<string, unknown>> | undefined,
): DumpAttemptContext | undefined {
  const value = metadata?.[DUMP_ATTEMPT_CONTEXT_KEY];
  return isDumpAttemptContext(value) ? value : undefined;
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
