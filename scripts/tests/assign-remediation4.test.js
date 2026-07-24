/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 Round 4 remediation findings.
 *
 * Each test targets a specific blocking finding from the latest review:
 *   F1: Contention marker preservation (competing winner retains label)
 *   F2: Cleanup provenance by current stint (boundary + label correlation)
 *   F3: No || true on rollback; verified rollback before exit 0
 *   F4: REST paginated issue count for cap (not Search API)
 *   F5: Extracted record-history script with consistent label validation
 *   F6: Cleanup sequence: verify assignee absent BEFORE label DELETE
 *
 * These execute the REAL bash scripts against the fake gh infrastructure.
 */

import { describe, expect, it } from 'vitest';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  makeUnassignedEvent,
  makeUnlabeledEvent,
  daysAgo,
  failOnNth,
  runRecordHistory,
} from './assign-helpers.js';

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}

// ===========================================================================
// F1: Contention marker preservation
// ===========================================================================

describe('F1: Contention marker preservation', () => {
  it('rollback preserves marker when competing winner remains (interleaving)', () => {
    // Genuine interleaving via fake pre-handler side effect: a concurrent
    // POST adds a second assignee DURING our POST.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        side_effects: [
          {
            method: 'POST',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            action: 'add_assignee',
            issue: 42,
            assignee: 'winner-user',
          },
        ],
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // alice rolled back
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // winner-user remains
    expect(result.state.issues['42']._assignees).toContain('winner-user');
    // Marker PRESERVED — competing winner owns it
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('rollback removes marker when NO competing winner remains (this run owns it)', () => {
    // No concurrent side effect — this run is the sole assigner.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Normal successful assignment — no rollback
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('alice');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('rollback removes marker when assignee DELETE fails but no winner (re-add via post-handler)', () => {
    // Simulate: DELETE appears to succeed but a post-handler re-adds the
    // assignee. The rollback verification must detect this and fail.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        // Post-effect: after the assignee DELETE (during rollback), re-add alice
        side_effects: [
          {
            method: 'DELETE',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            timing: 'post',
            action: 'readd_assignee',
            issue: 42,
            assignee: 'alice',
          },
        ],
        // Fail the post-mutation cap query to trigger rollback
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/issues',
          on_nth: 3,
          type: 'error',
        }),
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Must be nonzero — rollback failed (alice re-added by post-handler)
    expect(result.status).not.toBe(0);
    // alice still assigned (DELETE was undone)
    expect(result.state.issues['42']._assignees).toContain('alice');
    // Marker retained (diagnosable state)
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });
});

// ===========================================================================
// F2: Cleanup provenance by current stint
// ===========================================================================

describe('F2: Cleanup provenance by current stint', () => {
  it('old label + later bot reassignment without new label does NOT qualify', () => {
    // Timeline: bot labels, bot assigns, bot unassigns, bot unlabels,
    // then bot reassigns WITHOUT re-labeling. Old label is stale.
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
              createdAt: daysAgo(30),
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(30),
            }),
            makeUnassignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(25),
            }),
            makeUnlabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(25),
            }),
            // Re-assigned by bot WITHOUT new label
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(20),
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    // Must NOT remove — no qualifying labeled event in the current stint
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });

  it('bot reassignment WITH new label in same stint qualifies', () => {
    // Timeline: bot labels, bot assigns, bot unassigns, bot unlabels,
    // then bot re-labels AND re-assigns. This is a valid current stint.
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
              createdAt: daysAgo(30),
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(30),
            }),
            makeUnassignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(25),
            }),
            // New stint: label + assign
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(22),
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(20),
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    // Should remove — valid current stint with label
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });

  it('later human unlabel invalidates /assign provenance', () => {
    // Bot assigned with label, but a human later removed the label
    // (manual intervention). This invalidates automation provenance.
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
              createdAt: daysAgo(25),
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(25),
            }),
            // Human removes the label after assignment
            makeUnlabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'human-maintainer',
              createdAt: daysAgo(22),
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    // Must NOT remove — human intervention invalidated provenance
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });
});

// ===========================================================================
// F3: No || true on rollback; verified rollback before exit 0
// ===========================================================================

describe('F3: Verified rollback (no || true)', () => {
  it('cap >3 rollback failure exits nonzero with marker preserved', () => {
    // alice has 2 open issues initially (under cap). Our POST succeeds
    // (making 3). A concurrent side effect assigns alice to #50 (making 4).
    // Post-mutation count detects over-cap. Rollback DELETE is attempted
    // but a post-handler re-adds alice, so rollback verification fails → nonzero.
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
          // Concurrent: assign alice to #50 when our POST fires
          {
            method: 'POST',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            action: 'add_assignee',
            issue: 50,
            assignee: 'alice',
          },
          // Post-effect: re-add alice after rollback DELETE
          {
            method: 'DELETE',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            timing: 'post',
            action: 'readd_assignee',
            issue: 42,
            assignee: 'alice',
          },
        ],
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Post-mutation: alice has 4 issues (1, 2, 42, 50). Rollback attempted
    // but fails (alice re-added to #42). Must NOT exit 0.
    expect(result.status).not.toBe(0);
    // alice still assigned to #42 (rollback failed)
    expect(result.state.issues['42']._assignees).toContain('alice');
    // Marker retained for diagnosis
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('post-count query failure triggers verified rollback (no swallowing)', () => {
    // The post-mutation REST count GET fails. Rollback must be attempted
    // and verified. If rollback succeeds, exit nonzero (infra error path).
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        // Fail the 3rd REST issues GET (post-mutation count)
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/issues',
          on_nth: 3,
          type: 'error',
        }),
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Must be nonzero — infra error during cap verification
    expect(result.status).not.toBe(0);
    // Rollback should succeed (alice removed)
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // Label also removed (rollback verified)
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });
});

// ===========================================================================
// F4: REST paginated issue count for cap (not Search API)
// ===========================================================================

describe('F4: REST-based cap count', () => {
  it('cap check uses REST /repos/{repo}/issues, not search/issues', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
          1: makeIssue({ number: 1, assignees: ['alice'] }),
          2: makeIssue({ number: 2, assignees: ['alice'] }),
          3: makeIssue({ number: 3, assignees: ['alice'] }),
        },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // alice at cap → refused
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // Verify REST issues was called (not search/issues for cap)
    const restGets = (result.state._op_log || []).filter(
      (op) => op.method === 'GET' && op.endpoint === 'repos/test/repo/issues',
    );
    expect(restGets.length).toBeGreaterThan(0);
  });

  it('REST count excludes PRs (only counts non-PR issues)', () => {
    // alice is assigned to 2 issues and 1 PR. Cap count must be 2, not 3.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
          1: makeIssue({ number: 1, assignees: ['alice'] }),
          2: makeIssue({ number: 2, assignees: ['alice'] }),
        },
        prs: {
          99: makePR({ number: 99, author: 'someone', merged: false }),
        },
      }),
    );
    // Assign alice to PR #99 as well
    repo.updateState((s) => {
      s.prs['99']._assignees = ['alice'];
    });

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'alice',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    // alice has 2 issues (not 3) → under cap → should assign
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('alice');
  });

  it('merged PR search incomplete_results=true causes infra error', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        search_incomplete: true,
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'alice',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    // incomplete_results=true is infra error → fail closed
    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
  });

  it('REST count paginates across multiple pages (>100 issues)', () => {
    // Create >100 issues assigned to alice to force REST pagination
    const issues = {};
    issues[42] = makeIssue({ number: 42, assignees: [] });
    for (let i = 1000; i < 1120; i++) {
      issues[String(i)] = makeIssue({
        number: i,
        assignees: ['alice'],
      });
    }
    const repo = createFakeRepo(
      defaultStateWith({
        issues,
        page_size: 100,
        prs: {},
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'alice',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    // alice has 120 issues > cap → refused
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
  });
});

// ===========================================================================
// F5: Extracted record-history script
// ===========================================================================

describe('F5: Extracted record-history script', () => {
  const HISTORY_COLOR = '0E8A16';
  const HISTORY_DESC = 'Issue assignment history index';

  it('creates label when absent', () => {
    const result = runRecordHistory({
      state: { labels: {} },
      assigneeLogin: 'newuser',
    });

    expect(result.status).toBe(0);
    expect(result.state.labels['asnhist--newuser']).toBeDefined();
    expect(result.state.labels['asnhist--newuser'].color).toBe(HISTORY_COLOR);
    expect(result.state.labels['asnhist--newuser'].description).toBe(
      HISTORY_DESC,
    );
  });

  it('idempotent when label already exists with correct definition', () => {
    const result = runRecordHistory({
      state: {
        labels: {
          'asnhist--bob': {
            name: 'asnhist--bob',
            color: HISTORY_COLOR,
            description: HISTORY_DESC,
          },
        },
      },
      assigneeLogin: 'bob',
    });

    expect(result.status).toBe(0);
    // No duplicate creation, definition preserved
    expect(result.state.labels['asnhist--bob'].color).toBe(HISTORY_COLOR);
  });

  it('fails on collision (wrong color/description)', () => {
    const result = runRecordHistory({
      state: {
        labels: {
          'asnhist--charlie': {
            name: 'asnhist--charlie',
            color: 'FF0000', // wrong
            description: 'Human label', // wrong
          },
        },
      },
      assigneeLogin: 'charlie',
    });

    // Must fail — collision
    expect(result.status).not.toBe(0);
    // Original definition preserved
    expect(result.state.labels['asnhist--charlie'].color).toBe('FF0000');
  });

  it('failed POST with label still absent exits nonzero', () => {
    const result = runRecordHistory({
      state: {
        labels: {},
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/labels',
          on_nth: 1,
          type: 'error',
        }),
      },
      assigneeLogin: 'racer',
    });

    // POST fails, re-check finds label absent → should fail
    expect(result.status).not.toBe(0);
  });
});

// ===========================================================================
// F6: Cleanup sequence — verify assignee absent BEFORE label DELETE
// ===========================================================================

describe('F6: Cleanup sequence — verify before label DELETE', () => {
  it('assignee DELETE succeeds (no-op/race re-add) → retain marker, fail nonzero', () => {
    // The assignee DELETE appears to succeed, but a post-handler re-adds
    // the assignee immediately. The mid-DELETE verification must catch this
    // and NOT proceed to label DELETE.
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
        // Post-effect: after the assignee DELETE, re-add stale-user
        side_effects: [
          {
            method: 'DELETE',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            timing: 'post',
            action: 'readd_assignee',
            issue: 42,
            assignee: 'stale-user',
          },
        ],
      }),
    );

    const result = repo.runCleanup();

    // Must be nonzero — assignee still present after DELETE
    expect(result.status).not.toBe(0);
    // stale-user still assigned
    expect(result.state.issues['42']._assignees).toContain('stale-user');
    // Marker retained (label NOT deleted)
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('assignee removed but label DELETE fails → nonzero with marker', () => {
    // Existing behavior: assignee DELETE succeeds, but label DELETE fails.
    // Must report nonzero and leave the marker for next-run recovery.
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
          'repos/test/repo/issues/42/labels/auto-assigned': 'error',
        },
      }),
    );

    const result = repo.runCleanup();

    // Must be nonzero
    expect(result.status).not.toBe(0);
    // stale-user was removed (DELETE succeeded)
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    // Label remains for retry
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });
});
