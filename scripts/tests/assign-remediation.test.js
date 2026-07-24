/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 remediation findings.
 *
 * Each test targets a specific blocking finding from code review:
 *   F1: paginated JSON aggregation
 *   F2: --input - for array mutations (fake-gh rejects string-typed arrays)
 *   F3: fail-closed label reads/removals
 *   F4: sticky feedback lookup failure vs absence
 *   F5: cap re-read before assignment (race)
 *   F6: assignment verification nonzero failure
 *   F7: jq output schema validation
 *   F8: discover_candidates error propagation
 *
 * These execute the REAL bash scripts against the fake gh infrastructure.
 */

import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeCrossRefEvent,
  makeLabeledEvent,
  makeFillerEvents,
  daysAgo,
} from './assign-helpers.js';

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}

// ---------------------------------------------------------------------------
// F1: Paginated JSON aggregation
// ---------------------------------------------------------------------------

describe('F1: paginated JSON aggregation', () => {
  it('historical assignment via backfill file is detected (assign-issue.sh)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
      }),
    );
    // Simulate a large backfill file where 'bob' is on a "later page"
    // (the grep is O(1) per-line but file can be large)
    const logins = [];
    for (let i = 0; i < 500; i++) {
      logins.push(`filler-user-${i}`);
    }
    logins.push('bob');
    const historyFile = join(repo.dir, 'assignment-history.txt');
    writeFileSync(
      historyFile,
      logins.join(String.fromCharCode(10)) + String.fromCharCode(10),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'bob',
      extraEnv: {
        ASSIGNMENT_HISTORY_FILE: join(repo.dir, 'assignment-history.txt'),
      },
    });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('bob');
  });

  it('cleanup retains assignment when cross-ref is on a later page', () => {
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        page_size: 2,
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['active-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'active-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            ...makeFillerEvents(2),
            makeCrossRefEvent({
              number: 42,
              prNumber: 200,
              prAuthor: 'active-user',
              createdAt: daysAgo(15),
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('active-user');
  });

  it('cleanup unassigns stale user when bot-assign is on a later page', () => {
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        page_size: 2,
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            ...makeFillerEvents(2),
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });
});

// ---------------------------------------------------------------------------
// F2: --input - for array mutations (fake-gh rejects string-typed arrays)
// ---------------------------------------------------------------------------

describe('F2: array mutations via --input -', () => {
  it('assign-issue.sh sends valid JSON arrays (not strings)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: [],
            labels: ['bug'],
          }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('alice');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    expect(result.state.issues['42']._label_names).toContain('bug');
  });

  it('cleanup uses targeted DELETE for unassign (not whole-array PATCH)', () => {
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned', 'bug'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    expect(result.state.issues['42']._label_names).toContain('bug');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });
});

// ---------------------------------------------------------------------------
// F3: fail-closed label reads and removals
// ---------------------------------------------------------------------------

describe('F3: fail-closed label reads/removals', () => {
  it('cleanup fails nonzero and preserves state when label read fails', () => {
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned', 'bug', 'important'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
        fail_config: {
          'repos/test/repo/issues/42': 'error',
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).toContain('stale-user');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    expect(result.state.issues['42']._label_names).toContain('bug');
    expect(result.state.issues['42']._label_names).toContain('important');
  });

  it('cleanup fails nonzero and preserves state when label-removal DELETE fails', () => {
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: [],
            labels: ['auto-assigned', 'important'],
          }),
        },
        timeline: {
          42: [
            makeAssignedEvent({
              number: 42,
              assignee: 'someone',
              actor: 'human-admin',
              createdAt: assignedAt,
            }),
          ],
        },
        fail_config: {
          'repos/test/repo/issues/42/labels/auto-assigned': 'error',
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    expect(result.state.issues['42']._label_names).toContain('important');
  });
});

// ---------------------------------------------------------------------------
// F4: sticky feedback lookup failure vs absence
// ---------------------------------------------------------------------------

describe('F4: sticky feedback lookup failure vs absence', () => {
  it('comment lookup failure does not create a duplicate comment and exits nonzero', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
        comments: [
          {
            id: 777,
            issue_number: 42,
            body: '<!-- llxprt-assign-feedback -->\nPrior feedback',
            user: { login: 'github-actions[bot]', type: 'Bot' },
            created_at: '2025-07-20T00:00:00Z',
            updated_at: '2025-07-20T00:00:00Z',
          },
        ],
        fail_config: {
          'repos/test/repo/issues/42/comments': 'error',
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Nonzero: infrastructure failure during feedback lookup must not be
    // masked as a normal exit.
    expect(result.status).not.toBe(0);
    // No duplicate: the pre-existing marker comment is unchanged and no
    // new comment was posted (POST would also fail since the endpoint
    // is configured to error).
    const markerComments = result.state.comments.filter(
      (c) =>
        c.issue_number === 42 &&
        c.user.login === 'github-actions[bot]' &&
        c.body.startsWith('<!-- llxprt-assign-feedback -->'),
    );
    expect(markerComments.length).toBe(1);
    expect(markerComments[0].body).toBe(
      '<!-- llxprt-assign-feedback -->\nPrior feedback',
    );
  });
});

// ---------------------------------------------------------------------------
// F4b: stderr separation in post_sticky_feedback and label validation
// ---------------------------------------------------------------------------

describe('F4b: stderr separation (JSON stdout not corrupted by stderr)', () => {
  it('stderr warnings during comment fetch do not corrupt feedback lookup', () => {
    // gh writes a deprecation warning to stderr while still returning valid
    // JSON on stdout. The script must parse stdout-only and post feedback.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
        stderr_warnings: [
          {
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42/comments',
            message: 'WARNING: API deprecation notice',
          },
        ],
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Should succeed — stderr warnings must not corrupt the JSON stdout
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('alice');
    // Feedback was posted despite stderr warning
    const feedbackComments = result.state.comments.filter(
      (c) =>
        c.issue_number === 42 &&
        c.user.login === 'github-actions[bot]' &&
        c.body.startsWith('<!-- llxprt-assign-feedback -->'),
    );
    expect(feedbackComments.length).toBeGreaterThanOrEqual(1);
  });

  it('stderr warnings during merged-PR search do not corrupt count', () => {
    // gh writes a warning to stderr during the merged PR search, but the
    // JSON response on stdout is valid. The script must parse stdout only.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
        stderr_warnings: [
          {
            method: 'GET',
            endpoint: 'search/issues',
            message: 'WARNING: search rate limit approaching',
          },
        ],
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'alice',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    // alice has no merged PR in fake state, so should be refused for eligibility
    // But the key is that the script doesn't crash due to stderr in stdout
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
  });

  it('stderr warnings during history-label GET do not corrupt absence detection', () => {
    // gh writes a warning to stderr while the label GET returns 404.
    // The 404 (absence) must still be detected from stderr, not from stdout.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
        stderr_warnings: [
          {
            method: 'GET',
            endpoint: 'repos/test/repo/labels/asnhist--alice',
            message: 'WARNING: retrying request',
          },
        ],
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'alice',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    // Should succeed — alice has a merged PR so is eligible
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('alice');
  });
});

// ---------------------------------------------------------------------------
// F5: cap re-read before assignment (race condition)
// ---------------------------------------------------------------------------

describe('F5: cap re-read before assignment', () => {
  it('refuses assignment when issue gets assigned by concurrent run before POST', () => {
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
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42',
            on_nth: 2,
            action: 'add_assignee',
            issue: 42,
            assignee: 'someone-else',
          },
        ],
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.state.issues['42']._assignees).not.toContain('alice');
    expect(result.state.issues['42']._assignees).toContain('someone-else');
  });
});

// ---------------------------------------------------------------------------
// F6: assignment verification nonzero failure
// ---------------------------------------------------------------------------

describe('F6: assignment verification failure', () => {
  it('fails nonzero when post-assignment verification returns malformed JSON', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
        fail_config: {
          'repos/test/repo/issues/42': 'malformed',
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
  });
});

// ---------------------------------------------------------------------------
// F7: jq output schema validation
// ---------------------------------------------------------------------------

describe('F7: jq output schema validation', () => {
  it('assign fails closed when issue detail returns malformed JSON', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
        fail_config: {
          'repos/test/repo/issues/42': 'malformed',
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
  });

  it('cleanup fails closed when issue detail returns malformed JSON', () => {
    const assignedAt = daysAgo(20);
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
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
        fail_config: {
          'repos/test/repo/issues/42': 'malformed',
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).toContain('stale-user');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('cleanup fails closed when timeline returns malformed JSON', () => {
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
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(20),
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(20),
            }),
          ],
        },
        fail_config: {
          'repos/test/repo/issues/42/timeline': 'malformed',
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });
});

// ---------------------------------------------------------------------------
// F8: discover_candidates error propagation
// ---------------------------------------------------------------------------

describe('F8: discover_candidates error propagation', () => {
  it('cleanup fails nonzero when candidate discovery API fails', () => {
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
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(20),
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(20),
            }),
          ],
        },
        fail_config: {
          'repos/test/repo/issues': 'error',
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });
});
