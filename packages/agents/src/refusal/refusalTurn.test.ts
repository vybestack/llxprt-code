/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: what the turn loop does with the outcome of a refused attempt.
 */

import { describe, expect, it } from 'bun:test';
import type { StreamAttemptOutcome } from './refusalTurn.js';
import { rewroteCommittedHistory } from './refusalTurn.js';

function retry(historyRewritten?: boolean): StreamAttemptOutcome {
  return {
    error: null,
    action: 'retry-same-request',
    delayMs: 0,
    ...(historyRewritten !== undefined && {
      rewrite: { pendingEdits: [], historyRewritten },
    }),
  };
}

describe('a rewrite of committed history', () => {
  it('is reported when the reviewer rewrote the history', () => {
    expect(rewroteCommittedHistory(retry(true))).toBe(true);
  });

  it('is not reported when only the pending turn was rewritten', () => {
    expect(rewroteCommittedHistory(retry(false))).toBe(false);
  });

  it('is not reported for an identical retry or a stop', () => {
    expect([
      rewroteCommittedHistory(retry()),
      rewroteCommittedHistory({ error: null, action: 'stop' }),
    ]).toStrictEqual([false, false]);
  });
});
