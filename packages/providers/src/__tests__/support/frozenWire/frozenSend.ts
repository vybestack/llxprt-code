/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: sends a frozen case through today's real provider and
 * reduces the request body to what the corpus records. The send is the one
 * `wireBodyGolden.test.ts` uses (`sendThroughRoute` against the fake HTTP
 * transport), so the bytes are the bytes the builders put on the wire.
 */

import { createHash } from 'node:crypto';
import { sendThroughRoute } from '../wireBodyCapture.js';
import type { HistoryCase } from '../wireBodyHistories.js';
import type { FrozenCase, FrozenFormat } from './frozenCases.js';
import { topLevelMember } from './topLevelMember.js';

export interface SentRecord {
  /** Byte length of the whole request body. */
  readonly length: number;
  readonly sha256: string;
  /** Byte length of the history member (`messages` or `input`). */
  readonly member: number;
}

export interface ThrownRecord {
  readonly threw: string;
}

export type CaseOutcome = SentRecord | ThrownRecord;

export function didThrow(outcome: CaseOutcome): outcome is ThrownRecord {
  return 'threw' in outcome;
}

function historyCaseOf(frozen: FrozenCase): HistoryCase {
  const { settings } = frozen;
  return {
    id: `seed-${frozen.seed}`,
    description: 'frozen wire corpus case',
    rows: frozen.rows,
    ephemerals: settings.ephemerals,
    ...(settings.systemInstruction === null
      ? {}
      : { systemInstruction: settings.systemInstruction }),
  };
}

export function recordBody(bytes: Uint8Array, member: string): SentRecord {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const memberText = topLevelMember(text, member);
  if (memberText === undefined) {
    throw new Error(`request body has no ${member} member`);
  }
  return {
    length: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    member: Buffer.byteLength(memberText),
  };
}

/** The bytes today's builders write for a case, or the error they throw. */
export async function sendCase(
  format: FrozenFormat,
  frozen: FrozenCase,
): Promise<CaseOutcome> {
  const route = {
    ...format.route,
    model: frozen.settings.model,
    providerSettings: {
      ...format.route.providerSettings,
      ...frozen.settings.providerSettings,
    },
  };
  let request: Awaited<ReturnType<typeof sendThroughRoute>>;
  try {
    request = await sendThroughRoute(route, historyCaseOf(frozen), 'stream');
  } catch (error) {
    // A history the builders reject is part of what the corpus freezes.
    return { threw: error instanceof Error ? error.message : String(error) };
  }
  return recordBody(request.bytes, format.historyMember);
}
