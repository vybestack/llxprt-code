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

/**
 * Issue #1611: pagination now orders by immutable createdAt + sessionId
 * (not updatedAt, which can change and cause session omission).
 */
const sessions: readonly LifecycleSession[] = [
  {
    sessionId: 'b',
    cwd: '/a',
    updatedAt: '2026-01-03T00:00:00.000Z',
    createdAt: '2026-01-03T00:00:00.000Z',
  },
  {
    sessionId: 'a',
    cwd: '/a',
    updatedAt: '2026-01-03T00:00:00.000Z',
    createdAt: '2026-01-03T00:00:00.000Z',
  },
  {
    sessionId: 'c',
    cwd: '/b',
    updatedAt: '2026-01-02T00:00:00.000Z',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
];

describe('session lifecycle pagination', () => {
  it('orders by createdAt then sessionId descending and continues with an opaque cursor', () => {
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

  it('updatedAt changes cannot omit sessions: immutable createdAt ordering (issue #1611)', () => {
    // Two sessions with different createdAt and updatedAt values. Ordering must
    // remain stable when a session is updated mid-pagination because it uses
    // createdAt + sessionId, so the cursor is not invalidated.
    const stable: LifecycleSession[] = [
      {
        sessionId: 'x',
        cwd: '/w',
        updatedAt: '2026-07-12T12:00:00.000Z',
        createdAt: '2026-07-10T10:00:00.000Z',
      },
      {
        sessionId: 'y',
        cwd: '/w',
        updatedAt: '2026-07-12T13:00:00.000Z',
        createdAt: '2026-07-10T09:00:00.000Z',
      },
    ];
    const first = paginateSessions(stable, { cwd: null, cursor: null }, 1);
    expect(first.sessions[0].sessionId).toBe('x');

    // Simulate the "updatedAt changed between pages" scenario:
    // After page 1, the first session's updatedAt changes — but createdAt
    // is immutable, so the cursor still correctly filters.
    const firstAfterMutation: LifecycleSession = {
      ...stable[0],
      updatedAt: '2026-07-12T23:59:59.000Z',
    };
    const secondSet = [firstAfterMutation, stable[1]];
    const second = paginateSessions(
      secondSet,
      { cwd: null, cursor: first.nextCursor ?? null },
      10,
    );
    expect(second.sessions.map((s) => s.sessionId)).toStrictEqual(['y']);
  });

  it('v2 cursor is self-contained and process-independent (issue #1611)', () => {
    // The cursor encodes the full (createdAt, sessionId) tuple so the next
    // page can be computed without shared state.
    const first = paginateSessions(sessions, { cwd: null, cursor: null }, 2);
    expect(first.nextCursor).toStrictEqual(expect.any(String));

    // Decode the cursor to verify it's self-contained.
    const decoded = JSON.parse(
      Buffer.from(first.nextCursor!, 'base64url').toString('utf8'),
    );
    expect(decoded.v).toBe(2);
    expect(decoded.createdAt).toBeDefined();
    expect(decoded.sessionId).toBe('a');
    expect(decoded.cwd).toBeNull();
  });

  it('falls back to updatedAt when createdAt is absent (legacy)', () => {
    const legacy: LifecycleSession[] = [
      { sessionId: 'old', cwd: '/w', updatedAt: '2026-01-01T00:00:00.000Z' },
      { sessionId: 'new', cwd: '/w', updatedAt: '2026-06-01T00:00:00.000Z' },
    ];
    const result = paginateSessions(legacy, { cwd: null, cursor: null }, 10);
    expect(result.sessions.map((s) => s.sessionId)).toStrictEqual([
      'new',
      'old',
    ]);
  });

  it('rejects a legacy v1 cursor (version mismatch)', () => {
    const v1Cursor = Buffer.from(
      JSON.stringify({
        version: 1,
        cwd: null,
        updatedAt: '2026-01-03T00:00:00.000Z',
        sessionId: 'b',
      }),
    ).toString('base64url');
    expect(() =>
      paginateSessions(sessions, { cwd: null, cursor: v1Cursor }, 2),
    ).toThrow(/cursor/i);
  });
});
