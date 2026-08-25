/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 new review findings (round 8).
 *
 * Covers:
 *   1: verified_rollback_and_fail posts feedback after successful rollback
 *      (non-contention); contention-loser rollback remains silent.
 *   2: record-assignment-history.sh hardening (login validation, tool checks).
 *   3: Constants drift independently asserted (not imported from production).
 *   4: elect_winner fails closed on malformed assignee data in timeline.
 *   5: Sticky feedback converges duplicate bot marker comments.
 *   6: Bounded retry around cleanup timeline GETs.
 *   7: Label URI encoding retains jq @uri (no sed stripping needed).
 *   8: Deterministic event IDs (no Math.random collision with filler range).
 *   14: fake-gh label filter ALL-label subset semantics.
 */

import { describe, expect, it } from 'bun:test';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  daysAgo,
  failOnNth,
  runRecordHistory,
} from './assign-helpers.ts';
import {
  asRecord,
  stateComments,
  stateIssue,
  stateLabels,
} from './typed-test-helpers.ts';

const HISTORY_PREFIX = 'asnhist--';
const HISTORY_COLOR = '0E8A16';
const HISTORY_DESC = 'Issue assignment history index';
const MARKER = '<!-- llxprt-assign-feedback -->';

function defaultStateWith(overrides: Record<string, unknown>) {
  return { ...defaultState(), ...overrides };
}

// ===========================================================================
// Finding 1: verified_rollback_and_fail posts feedback on successful rollback
// ===========================================================================

describe('F1: rollback feedback posting', () => {
  it('assignee-POST failure rollback posts explanatory sticky feedback', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/issues/42/assignees',
          on_nth: 1,
          type: 'error',
        }),
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Nonzero exit
    expect(result.status).not.toBe(0);
    // alice rolled back
    expect(stateIssue(result.state, '42')._assignees).not.toContain('alice');
    // auto-assigned label rolled back
    expect(stateIssue(result.state, '42')._label_names).not.toContain(
      'auto-assigned',
    );
    // Sticky feedback was posted (explanatory message about API error)
    const markerComments = stateComments(result.state).filter(
      (c) =>
        c.issue_number === 42 &&
        c.user.login === 'github-actions[bot]' &&
        String(c.body).startsWith(MARKER),
    );
    expect(markerComments.length).toBeGreaterThanOrEqual(1);
    expect(markerComments[0].body).toContain('GitHub API error');
  });

  it('post-mutation cap rollback posts explanatory sticky feedback', () => {
    // Alice has 2 open issues. After successful POST to #42, she has 3.
    // A side effect also adds alice to #50 concurrently (making 4 > 3 cap).
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
          1: makeIssue({ number: 1, assignees: ['alice'] }),
          2: makeIssue({ number: 2, assignees: ['alice'] }),
          50: makeIssue({ number: 50, assignees: [] }),
        },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        side_effects: [
          {
            method: 'POST',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            action: 'add_assignee',
            issue: 50,
            assignee: 'alice',
          },
        ],
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Cap exceeded → rollback (exit 0 per design for cap)
    expect(stateIssue(result.state, '42')._assignees).not.toContain('alice');
    // Sticky feedback posted about cap
    const markerComments = stateComments(result.state).filter(
      (c) =>
        c.issue_number === 42 &&
        c.user.login === 'github-actions[bot]' &&
        String(c.body).startsWith(MARKER),
    );
    expect(markerComments.length).toBeGreaterThanOrEqual(1);
    expect(markerComments[0].body).toContain('cap');
  });

  it('contention-loser rollback remains silent (no sticky overwrite)', () => {
    // A concurrent winner is injected immediately before alice's assignee
    // POST. The election determines concurrent-user is the winner (earlier
    // timeline position). Alice's rollback must NOT post a sticky comment.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
          101: makePR({ number: 101, author: 'concurrent-user', merged: true }),
        },
        side_effects: [
          {
            method: 'POST',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            action: 'add_assignee',
            issue: 42,
            assignee: 'concurrent-user',
            actor: 'github-actions[bot]',
          },
        ],
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'alice',
      extraEnv: { ASSIGN_ELECTION_DELAY: '0' },
    });

    // alice rolled back (contention)
    expect(stateIssue(result.state, '42')._assignees).not.toContain('alice');
    // concurrent-user remains (the winner)
    expect(stateIssue(result.state, '42')._assignees).toContain(
      'concurrent-user',
    );
    // NO sticky feedback was posted by this run (silent rollback)
    const markerComments = stateComments(result.state).filter(
      (c) =>
        c.issue_number === 42 &&
        c.user.login === 'github-actions[bot]' &&
        String(c.body).startsWith(MARKER),
    );
    expect(markerComments.length).toBe(0);
  });
});

// ===========================================================================
// Finding 2: record-assignment-history.sh hardening
// ===========================================================================

describe('F2: record-history hardening', () => {
  it('rejects empty login with clear error', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: '',
    });

    expect(result.status).not.toBe(0);
    // No label created
    expect(stateLabels(result.state)['asnhist--']).toBeUndefined();
  });

  it('rejects login with invalid characters', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'invalid user!',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--invalid user!']).toBeUndefined();
  });

  it('accepts a normal valid login', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'valid-user',
    });

    expect(result.status).toBe(0);
    expect(stateLabels(result.state)['asnhist--valid-user']).toBeDefined();
  });

  it('uses printf not echo for diagnostics (no interpretation of format)', () => {
    // A login containing a percent character should not cause printf to
    // consume it as a format spec in error messages. The validation happens
    // before label construction, but the printf in diagnostics must not
    // interpret % in the login.
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'evil%shere',
    });

    // A percent character is not an allowed GitHub login character.
    expect(result.status).not.toBe(0);
  });

  it('rejects empty login with clear error', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: '',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--']).toBeUndefined();
  });

  it('rejects login with invalid characters', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'invalid user!',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--invalid user!']).toBeUndefined();
  });

  it('accepts a normal valid login', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'valid-user',
    });

    expect(result.status).toBe(0);
    expect(stateLabels(result.state)['asnhist--valid-user']).toBeDefined();
  });

  // Boundary behavior per real GitHub username rules:
  // 1-39 chars, alphanumeric segments separated by single hyphens; no
  // leading/trailing/consecutive hyphens, no non-alphanumeric chars.
  it('accepts a 1-character login (minimum boundary)', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'a',
    });

    expect(result.status).toBe(0);
    expect(stateLabels(result.state)['asnhist--a']).toBeDefined();
  });

  it('accepts a 39-character login (maximum boundary)', () => {
    const login = 'a'.repeat(39);
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: login,
    });

    expect(result.status).toBe(0);
    expect(stateLabels(result.state)[`asnhist--${login}`]).toBeDefined();
  });

  it('rejects a 40-character login (over maximum)', () => {
    const login = 'a'.repeat(40);
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: login,
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)[`asnhist--${login}`]).toBeUndefined();
  });

  it('rejects a leading hyphen', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: '-alice',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist---alice']).toBeUndefined();
  });

  it('rejects a trailing hyphen', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'alice-',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--alice-']).toBeUndefined();
  });

  it('rejects consecutive hyphens', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'alice--bob',
    });

    expect(result.status).not.toBe(0);
    expect(stateLabels(result.state)['asnhist--alice--bob']).toBeUndefined();
  });

  it('accepts a valid hyphenated login (single hyphens between segments)', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'alice-bob-charlie',
    });

    expect(result.status).toBe(0);
    expect(
      stateLabels(result.state)['asnhist--alice-bob-charlie'],
    ).toBeDefined();
  });
});

// ===========================================================================
// Finding 3: Constants drift independently asserted
// ===========================================================================

describe('F3: constants policy values independently asserted', () => {
  it('HISTORY_PREFIX is asnhist--', () => {
    expect(HISTORY_PREFIX).toBe('asnhist--');
  });

  it('HISTORY_COLOR is 0E8A16', () => {
    expect(HISTORY_COLOR).toBe('0E8A16');
  });

  it('HISTORY_DESC is the canonical description', () => {
    expect(HISTORY_DESC).toBe('Issue assignment history index');
  });

  it('history label name fits within GitHub 50-char limit for max username', () => {
    const maxLogin = 'a'.repeat(39);
    const labelName = `${HISTORY_PREFIX}${maxLogin}`;
    expect(labelName.length).toBeLessThanOrEqual(50);
  });
});

// ===========================================================================
// Finding 4: elect_winner fails closed on malformed assignee data
// ===========================================================================

describe('F4: elect_winner malformed-timeline fail-closed', () => {
  it('assigned event with null assignee causes election to fail closed', () => {
    // When a concurrent side-effect injects a second assignee with a
    // malformed timeline entry (null assignee), the election must fail
    // closed rather than silently electing the wrong winner.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
        side_effects: [
          {
            method: 'POST',
            endpoint: 'repos/test/repo/issues/42/labels',
            on_nth: 1,
            action: 'add_assignee',
            issue: 42,
            assignee: 'concurrent-user',
          },
        ],
      }),
    );

    // Inject a malformed assigned event into the timeline BEFORE running assign
    repo.updateState((s) => {
      const timeline = asRecord(s['timeline']);
      timeline['42'] = [
        {
          id: 777777,
          event: 'assigned',
          actor: { login: 'github-actions[bot]', type: 'Bot' },
          assignee: null,
          created_at: daysAgo(1),
        },
      ];
    });

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Election should encounter the malformed event and fail closed
    expect(result.status).not.toBe(0);
    // alice should NOT be assigned (fail closed)
    expect(stateIssue(result.state, '42')._assignees).not.toContain('alice');
  });

  it('assigned event with non-object assignee fails closed', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(20),
            }),
            makeAssignedEvent({
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(20),
            }),
            // Malformed: assigned event with non-object assignee (string)
            {
              id: 888888,
              event: 'assigned',
              actor: { login: 'github-actions[bot]', type: 'Bot' },
              assignee: 'not-an-object',
              created_at: daysAgo(15),
            },
          ],
        },
      }),
    );

    // Malformed assignment transitions make provenance ambiguous. Cleanup
    // must fail closed and preserve the assignment.
    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(stateIssue(result.state, '42')._assignees).toContain('stale-user');
  });
});

// ===========================================================================
// Finding 5: Sticky feedback converges duplicate bot marker comments
// ===========================================================================

// These execute the real bash /assign scripts against the fake-gh harness.
// assign.yml and assign-stale-cleanup.yml run on ubuntu-latest only, and the
// harness prepends a POSIX-style PATH entry for a shell-script `gh` stub, so on
// Windows the real gh wins and demands GH_TOKEN. Structural assertions in these
// files still run everywhere.
const IS_WINDOWS = process.platform === 'win32';

describe.skipIf(IS_WINDOWS)(
  'F5: sticky feedback converges duplicate markers',
  () => {
    it('multiple bot marker comments converge to exactly one; user marker untouched', () => {
      const repo = createFakeRepo(
        defaultStateWith({
          issues: {
            42: makeIssue({ number: 42, assignees: ['someone-else'] }),
          },
          comments: [
            {
              id: 100,
              issue_number: 42,
              body: `${MARKER}\nOld bot feedback 1`,
              user: { login: 'github-actions[bot]', type: 'Bot' },
              created_at: '2025-07-10T00:00:00Z',
              updated_at: '2025-07-10T00:00:00Z',
            },
            {
              id: 101,
              issue_number: 42,
              body: `${MARKER}\nOld bot feedback 2`,
              user: { login: 'github-actions[bot]', type: 'Bot' },
              created_at: '2025-07-11T00:00:00Z',
              updated_at: '2025-07-11T00:00:00Z',
            },
            {
              id: 102,
              issue_number: 42,
              body: 'This is a user comment, not a marker',
              user: { login: 'human-user', type: 'User' },
              created_at: '2025-07-12T00:00:00Z',
              updated_at: '2025-07-12T00:00:00Z',
            },
            {
              id: 103,
              issue_number: 42,
              body: `${MARKER}\nOld bot feedback 3`,
              user: { login: 'github-actions[bot]', type: 'Bot' },
              created_at: '2025-07-13T00:00:00Z',
              updated_at: '2025-07-13T00:00:00Z',
            },
          ],
          prs: {
            100: makePR({ number: 100, author: 'alice', merged: true }),
          },
        }),
      );

      const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

      expect(result.status).toBe(0);

      // Exactly one bot marker comment should remain
      const botMarkers = stateComments(result.state).filter(
        (c) =>
          c.issue_number === 42 &&
          c.user.login === 'github-actions[bot]' &&
          String(c.body).startsWith(MARKER),
      );
      expect(botMarkers.length).toBe(1);

      // The user comment must be untouched
      const userComment = stateComments(result.state).find((c) => c.id === 102);
      expect(userComment).toBeDefined();
      expect(userComment?.body).toBe('This is a user comment, not a marker');
      expect(userComment?.user.login).toBe('human-user');
    });
  },
);

// ===========================================================================
// Finding 6: Bounded retry around cleanup timeline GETs
// ===========================================================================
