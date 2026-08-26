/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
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
  function observeFirstCreatedAtOrderedPage() {
    return paginateSessions(sessions, { cwd: null, cursor: null }, 2);
  }

  function observeSecondCreatedAtOrderedPage(
    first: ReturnType<typeof paginateSessions>,
  ) {
    return paginateSessions(
      sessions,
      { cwd: null, cursor: first.nextCursor ?? null },
      2,
    );
  }

  function firstPaginatedSessionId(
    page: ReturnType<typeof paginateSessions>,
  ): string {
    const session = page.sessions.at(0);
    if (session === undefined) {
      throw new Error('Expected the page to contain a session');
    }
    return session.sessionId;
  }

  it('orders by createdAt then sessionId descending and continues with an opaque cursor', () => {
    const first = observeFirstCreatedAtOrderedPage();

    expect(first.sessions.map((session) => session.sessionId)).toStrictEqual([
      'b',
      'a',
    ]);
    expect(first.nextCursor).toStrictEqual(expect.any(String));

    const second = observeSecondCreatedAtOrderedPage(first);
    expect(second).toStrictEqual({ sessions: [sessions[2]] });
  });

  it('filters by exact cwd before pagination', () => {
    const result = paginateSessions(sessions, { cwd: '/a', cursor: null }, 10);
    expect(result.sessions.map((session) => session.sessionId)).toStrictEqual([
      'b',
      'a',
    ]);
  });

  it.each([
    ['empty', ''],
    ['invalid base64url', '***'],
    ['non-JSON base64url', Buffer.from('not json').toString('base64url')],
    [
      'JSON missing version',
      Buffer.from(JSON.stringify({ cwd: null })).toString('base64url'),
    ],
    [
      'JSON missing session identity',
      Buffer.from(
        JSON.stringify({
          v: 2,
          cwd: null,
          createdAt: '2026-01-03T00:00:00.000Z',
        }),
      ).toString('base64url'),
    ],
    [
      'v2 cursor with non-canonical timestamp',
      Buffer.from(
        JSON.stringify({
          v: 2,
          cwd: null,
          createdAt: '2026-01-03T00:00:00Z',
          sessionId: 'b',
        }),
      ).toString('base64url'),
    ],
  ])('rejects a malformed %s cursor', (_label, cursor) => {
    expect(() => paginateSessions(sessions, { cwd: null, cursor }, 2)).toThrow(
      /cursor/i,
    );
  });

  function verifyContinuesPaginationWithTheSameCwdFilter() {
    const first = paginateSessions(sessions, { cwd: '/a', cursor: null }, 1);
    const second = paginateSessions(
      sessions,
      { cwd: '/a', cursor: first.nextCursor ?? null },
      1,
    );

    return second.sessions;
  }

  it('continues pagination with the same cwd filter', () => {
    const secondPageSessions = verifyContinuesPaginationWithTheSameCwdFilter();
    expect(secondPageSessions).toStrictEqual([sessions[1]]);
  });

  function verifyRejectsACursorCreatedForADifferentCwdFilter() {
    const first = paginateSessions(sessions, { cwd: '/a', cursor: null }, 1);

    return () =>
      paginateSessions(
        sessions,
        { cwd: '/b', cursor: first.nextCursor ?? null },
        1,
      );
  }

  it('rejects a cursor created for a different cwd filter', () => {
    const paginateWithMismatchedCwd =
      verifyRejectsACursorCreatedForADifferentCwdFilter();
    expect(paginateWithMismatchedCwd).toThrow(/cursor/i);
  });

  function verifyUpdatedAtChangesCannotOmitSessionsImmutableCreatedAtOrderingIssue1611() {
    // Two sessions with different createdAt and updatedAt values. Ordering must
    // remain stable when a session is updated mid-pagination because it uses
    // createdAt + sessionId, so the cursor is not invalidated.
    const stable = [
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
    ] satisfies [LifecycleSession, LifecycleSession];
    const first = paginateSessions(stable, { cwd: null, cursor: null }, 1);

    return { stable, first };
  }

  function observePageAfterUpdatedAtMutation(
    stable: readonly [LifecycleSession, LifecycleSession],
    first: ReturnType<typeof paginateSessions>,
  ) {
    // Simulate the "updatedAt changed between pages" scenario:
    // After page 1, the first session's updatedAt changes — but createdAt
    // is immutable, so the cursor still correctly filters.
    const firstAfterMutation: LifecycleSession = {
      ...stable[0],
      updatedAt: '2026-07-12T23:59:59.000Z',
    };
    const secondSet = [firstAfterMutation, stable[1]];
    return paginateSessions(
      secondSet,
      { cwd: null, cursor: first.nextCursor ?? null },
      10,
    );
  }

  it('updatedAt changes cannot omit sessions: immutable createdAt ordering (issue #1611)', () => {
    const behaviorResult =
      verifyUpdatedAtChangesCannotOmitSessionsImmutableCreatedAtOrderingIssue1611();

    expect(firstPaginatedSessionId(behaviorResult.first)).toBe('x');

    const second = observePageAfterUpdatedAtMutation(
      behaviorResult.stable,
      behaviorResult.first,
    );
    expect(second.sessions.map((session) => session.sessionId)).toStrictEqual([
      'y',
    ]);
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

  it('falls back to updatedAt when createdAt is invalid', () => {
    const sessionsWithInvalidCreatedAt: LifecycleSession[] = [
      {
        sessionId: 'old',
        cwd: '/w',
        createdAt: 'not-a-date',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        sessionId: 'new',
        cwd: '/w',
        createdAt: '',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ];

    const result = paginateSessions(
      sessionsWithInvalidCreatedAt,
      { cwd: null, cursor: null },
      10,
    );

    expect(result.sessions.map((session) => session.sessionId)).toStrictEqual([
      'new',
      'old',
    ]);
  });

  function verifyContinuesALegacyPageWhenUpdatedAtIsValidButNotCanonical() {
    const legacy: LifecycleSession[] = [
      { sessionId: 'new', cwd: '/w', updatedAt: '2026-06-01T00:00:00Z' },
      { sessionId: 'old', cwd: '/w', updatedAt: '2026-01-01T00:00:00Z' },
    ];
    const first = paginateSessions(legacy, { cwd: null, cursor: null }, 1);
    const second = paginateSessions(
      legacy,
      { cwd: null, cursor: first.nextCursor ?? null },
      1,
    );

    return second.sessions.map((session) => session.sessionId);
  }

  it('continues a legacy page when updatedAt is valid but not canonical', () => {
    const sessionIds =
      verifyContinuesALegacyPageWhenUpdatedAtIsValidButNotCanonical();
    expect(sessionIds).toStrictEqual(['old']);
  });

  it('continues from a legacy v1 cursor using its updatedAt boundary', () => {
    const v1Cursor = Buffer.from(
      JSON.stringify({
        version: 1,
        cwd: null,
        updatedAt: '2026-01-03T00:00:00.000Z',
        sessionId: 'b',
      }),
    ).toString('base64url');
    const result = paginateSessions(
      sessions,
      { cwd: null, cursor: v1Cursor },
      2,
    );

    expect(result.sessions.map((session) => session.sessionId)).toStrictEqual([
      'a',
      'c',
    ]);
  });

  it('returns empty sessions with no nextCursor for an empty list', () => {
    const result = paginateSessions([], { cwd: null, cursor: null }, 10);
    expect(result.sessions).toStrictEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('returns no nextCursor when results fit exactly within pageSize', () => {
    const exact: LifecycleSession[] = [
      { sessionId: 'x', cwd: '/w', updatedAt: '2026-01-02T00:00:00.000Z' },
      { sessionId: 'y', cwd: '/w', updatedAt: '2026-01-01T00:00:00.000Z' },
    ];
    const result = paginateSessions(exact, { cwd: null, cursor: null }, 2);
    expect(result.sessions.map((s) => s.sessionId)).toStrictEqual(['x', 'y']);
    expect(result.nextCursor).toBeUndefined();
  });
});
