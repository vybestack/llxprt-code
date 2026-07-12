/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  paginateSessions,
  type LifecycleSession,
} from './zed-session-pagination.js';

const sessions: readonly LifecycleSession[] = [
  { sessionId: 'b', cwd: '/a', updatedAt: '2026-01-03T00:00:00.000Z' },
  { sessionId: 'a', cwd: '/a', updatedAt: '2026-01-03T00:00:00.000Z' },
  { sessionId: 'c', cwd: '/b', updatedAt: '2026-01-02T00:00:00.000Z' },
];

describe('session lifecycle pagination', () => {
  it('orders by updatedAt then sessionId descending and continues with an opaque cursor', () => {
    const first = paginateSessions(sessions, { cwd: null, cursor: null }, 2);
    expect(first.sessions.map((session) => session.sessionId)).toStrictEqual([
      'b',
      'a',
    ]);
    expect(first.nextCursor).toStrictEqual(expect.any(String));

    const second = paginateSessions(
      sessions,
      { cwd: null, cursor: first.nextCursor ?? null },
      2,
    );
    expect(second).toStrictEqual({ sessions: [sessions[2]] });
  });

  it('filters by exact cwd before pagination', () => {
    const result = paginateSessions(sessions, { cwd: '/a', cursor: null }, 10);
    expect(result.sessions.map((session) => session.sessionId)).toStrictEqual([
      'b',
      'a',
    ]);
  });

  it('rejects a malformed cursor', () => {
    expect(() =>
      paginateSessions(sessions, { cwd: null, cursor: 'not-a-cursor' }, 2),
    ).toThrow(/cursor/i);
  });

  it('rejects a cursor created for a different cwd filter', () => {
    const first = paginateSessions(sessions, { cwd: '/a', cursor: null }, 1);
    expect(() =>
      paginateSessions(
        sessions,
        { cwd: '/b', cursor: first.nextCursor ?? null },
        1,
      ),
    ).toThrow(/cursor/i);
  });
});
