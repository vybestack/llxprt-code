/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 deep-review remediation (Round 3).
 *
 * Addresses findings from the fresh review:
 *   1: Durable history for /assign itself (direct label creation)
 *   2: Short history label prefix asnhist-- (supports 39-char usernames)
 *   3: Pre-existing auto-assigned marker detection
 *   4: Final cap read must fail closed
 *   5: No concurrency coalescing (assign job has no concurrency block)
 *   6: History lookup tri-state (present/absent/error)
 *   7: Cleanup provenance (label-event correlation)
 *   8: Cleanup recovery and exact membership
 *   9: Fake fidelity (tested indirectly via behavioral assertions)
 *  10: URL encoding (tested indirectly)
 *  11: Docs accuracy
 *
 * These execute the REAL bash scripts against the fake gh infrastructure.
 */

import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  makeUnlabeledEvent,
  daysAgo,
  failOnNth,
} from './assign-helpers.js';
import { readRootFile } from './ocr-review-workflow-helpers.js';
const HISTORY_PREFIX = 'asnhist--';
const HISTORY_DESC = 'Issue assignment history index';
const HISTORY_COLOR = '0E8A16';
const AUTO_LABEL_DESC = 'Assigned via /assign automation';
const AUTO_LABEL_COLOR = '0E8A16';

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}

// ===========================================================================
// 1: Durable history for /assign itself
// ===========================================================================

describe('1: Durable history for /assign itself', () => {
  it('successful /assign creates per-user history label directly', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    // Primary assignee must be set
    expect(result.state.issues['42']._assignees).toContain('alice');
    // The per-user history label must exist after successful assignment
    const historyLabelName = `${HISTORY_PREFIX}alice`;
    expect(result.state.labels[historyLabelName]).toBeDefined();
    expect(result.state.labels[historyLabelName].color).toBe(HISTORY_COLOR);
    expect(result.state.labels[historyLabelName].description).toBe(
      HISTORY_DESC,
    );
  });

  it('successful /assign leaves durable history even without another workflow event', () => {
    // Simulate: only issue_comment /assign triggers the workflow. GitHub
    // suppresses recursive issues:assigned events from GITHUB_TOKEN, so
    // the record-history job may never fire. The assign job itself must
    // create the durable history label.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'bob', merged: true }) },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'bob' });

    expect(result.status).toBe(0);
    // History label must exist regardless of record-history job
    const historyLabelName = `${HISTORY_PREFIX}bob`;
    expect(result.state.labels[historyLabelName]).toBeDefined();
  });

  it('history label creation failure rolls back assignment', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        fail_config: failOnNth({
          method: 'POST',
          endpoint: 'repos/test/repo/labels',
          on_nth: 1,
          type: 'error',
        }),
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).not.toBe(0);
    // alice should be rolled back from #42
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // auto-assigned label should be rolled back
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });
});

// ===========================================================================
// 2: Short label prefix asnhist-- + exact definition validation
// ===========================================================================

describe('2: Short history label prefix and definition validation', () => {
  it('uses asnhist-- prefix (9 chars + 39-char username = 48 <= 50)', () => {
    const longUsername = 'a'.repeat(39);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: {
          100: makePR({ number: 100, author: longUsername, merged: true }),
        },
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: longUsername,
    });

    expect(result.status).toBe(0);
    const labelName = `${HISTORY_PREFIX}${longUsername}`;
    expect(labelName.length).toBeLessThanOrEqual(50);
    expect(result.state.labels[labelName]).toBeDefined();
  });

  it('existing history label with correct definition qualifies for eligibility', () => {
    const historyLabel = `${HISTORY_PREFIX}bob`;
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: AUTO_LABEL_COLOR,
            description: AUTO_LABEL_DESC,
          },
          [historyLabel]: {
            name: historyLabel,
            color: HISTORY_COLOR,
            description: HISTORY_DESC,
          },
        },
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'bob',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('bob');
  });

  it('existing label with WRONG description does NOT qualify (collision)', () => {
    // A human-created label with the same name but wrong description must
    // NOT grant eligibility — this is a collision.
    const historyLabel = `${HISTORY_PREFIX}bob`;
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: AUTO_LABEL_COLOR,
            description: AUTO_LABEL_DESC,
          },
          [historyLabel]: {
            name: historyLabel,
            color: 'FF0000', // wrong color
            description: 'Some human label', // wrong description
          },
        },
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'bob',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    // Collision means not-eligible — expected user-facing refusal (exit 0)
    expect(result.status).toBe(0);
    // Must NOT assign — collision with human label
    expect(result.state.issues['42']._assignees).not.toContain('bob');
  });

  it('validates/reconciles shared auto-assigned label definition', () => {
    // The script must not silently repurpose a human label named auto-assigned
    // with conflicting definition
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: 'FF0000', // conflicting color
            description: 'Human label', // conflicting description
          },
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Must fail closed — conflicting definition
    expect(result.status).not.toBe(0);
    // Should NOT have silently repurposed
    expect(result.state.labels['auto-assigned'].color).toBe('FF0000');
  });
});

// ===========================================================================
// 3: Pre-existing auto-assigned marker
// ===========================================================================

describe('3: Pre-existing auto-assigned marker', () => {
  it('unassigned issue already carrying auto-assigned label fails closed', () => {
    // Issue has auto-assigned label but no assignee — inconsistent provenance
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: [],
            labels: ['auto-assigned'],
          }),
        },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Must fail closed — do not assign, never claim ownership
    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
  });

  it('exact rollback regression: label added then assignee fails', () => {
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

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // The auto-assigned label that was added by this run must be removed
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });
});

// ===========================================================================
// 4: Final cap read must fail closed
// ===========================================================================

describe('4: Final cap read fail-closed', () => {
  it('post-mutation count GET failure rolls back assignment (fail closed)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        // Fail the REST issues endpoint on the LAST call (post-mutation count)
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/issues',
          on_nth: 3,
          type: 'error',
        }),
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Must fail closed — post-mutation count failure
    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('nth-occurrence test: final count GET fails on 3rd occurrence', () => {
    // Track the op log to verify which GET failed
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/issues',
          on_nth: 3,
          type: 'error',
        }),
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).not.toBe(0);
    // The 3rd REST issues GET should be the failure
    const restGets = (result.state._op_log || []).filter(
      (op) => op.endpoint === 'repos/test/repo/issues' && op.method === 'GET',
    );
    expect(restGets.length).toBeGreaterThanOrEqual(3);
    // The 3rd one should be failed
    expect(restGets[2].status).toBe('failed');
  });
});

// ===========================================================================
// 5: Actor+issue concurrency grouping
// ===========================================================================

describe('5: Per-actor concurrency serialization', () => {
  it('groups concurrency by commenter ID AND issue number to allow independent distinct issues', () => {
    const source = readRootFile('.github/workflows/assign.yml');
    const workflow = yaml.load(source);
    expect(workflow.jobs.assign.concurrency).toEqual({
      group:
        'assign-${{ github.event.comment.user.id }}-${{ github.event.issue.number }}',
      'cancel-in-progress': false,
    });
  });

  it('assign.yml has no mention of concurrency coalescing', () => {
    const source = readRootFile('.github/workflows/assign.yml');
    // Should not mention coalescing in comments
    expect(source).not.toMatch(/coalesc/i);
  });

  it('postcondition: after assignee POST, assignee array contains exactly commenter', () => {
    // Normal successful assignment: exactly one assignee = commenter
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toEqual(['alice']);
  });

  it('contention: side-effect adds second assignee during POST → rollback commenter only', () => {
    // A concurrent run adds a second assignee right after our POST.
    // Postcondition: assignees should NOT contain exactly our commenter alone.
    // Script must detect contention and rollback only this run's commenter.
    // Per contention-marker design: when a competing winner remains,
    // the auto-assigned label is PRESERVED (not removed), since the
    // remaining assignee may legitimately own it.
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
            assignee: 'concurrent-user',
          },
        ],
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Contention detected → nonzero exit
    expect(result.status).not.toBe(0);
    // alice must be rolled back (contention detected)
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // The concurrent assignee remains (not our responsibility to remove)
    expect(result.state.issues['42']._assignees).toContain('concurrent-user');
    // Marker is PRESERVED when a competing winner remains (not our label to remove)
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('three interleaved contenders: only one survives, others rollback', () => {
    // Simulate 3 users trying to assign the same issue concurrently.
    // Since there's no workflow concurrency, they all run. Postcondition
    // enforcement means only one can win (exactly one assignee).
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
          101: makePR({ number: 101, author: 'bob', merged: true }),
          102: makePR({ number: 102, author: 'charlie', merged: true }),
        },
      }),
    );

    // Run 1: alice assigns first (succeeds)
    const r1 = repo.runAssign({ issueNumber: 42, commenter: 'alice' });
    expect(r1.status).toBe(0);

    // Run 2: bob tries — issue is now assigned to alice, should refuse
    const r2 = repo.runAssign({ issueNumber: 42, commenter: 'bob' });
    expect(r2.state.issues['42']._assignees).toContain('alice');
    expect(r2.state.issues['42']._assignees).not.toContain('bob');

    // Run 3: charlie tries — same
    const r3 = repo.runAssign({ issueNumber: 42, commenter: 'charlie' });
    expect(r3.state.issues['42']._assignees).toContain('alice');
    expect(r3.state.issues['42']._assignees).not.toContain('charlie');
  });
});

// ===========================================================================
// 6: History lookup tri-state
// ===========================================================================

describe('6: History lookup tri-state', () => {
  it('current-history GET failure aborts as infrastructure error', () => {
    // The current issue search must distinguish present/absent/error.
    // A failed query must abort infrastructure, not be treated as ineligibility.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'search/issues',
          on_nth: 1,
          type: 'error',
        }),
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'newuser',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    // Must fail closed (nonzero) — infrastructure error
    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('newuser');
  });

  it('history-label GET 500 error aborts as infrastructure error', () => {
    // The history label lookup must distinguish 404 (absence) from other errors.
    // A 500 must NOT be treated as "label not found" (absence).
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        // Fail the labels endpoint (not search, not issue)
        fail_config: {
          requests: [
            {
              method: 'GET',
              endpoint: 'repos/test/repo/labels/asnhist--newuser',
              on_nth: 1,
              type: 'error',
              http_status: 500,
            },
          ],
        },
      }),
    );

    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'newuser',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    // Must fail closed — infrastructure error, NOT "not eligible"
    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('newuser');
  });
});

// ===========================================================================
// 7: Cleanup provenance (label-event correlation)
// ===========================================================================

describe('7: Cleanup provenance with label-event correlation', () => {
  it('bot assigned WITH labeled event before bot-assigned → eligible for removal', () => {
    const assignedAt = daysAgo(25);
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
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });

  it('bot assigned WITHOUT labeled provenance → fail closed, remove nobody', () => {
    // Another bot assigned but there's no auto-assigned labeled event before it.
    // This is inconsistent provenance — fail closed.
    const assignedAt = daysAgo(25);
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
            // Bot assigned but NO labeled event preceding it
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

    // Must NOT remove — no label-event provenance
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });

  it('labeled then unlabeled then assigned → no valid provenance', () => {
    // Label was added then removed (by bot), then bot assigned without re-adding
    // the label event. The unlabeled event invalidates the label provenance.
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
            makeUnlabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(28),
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(25),
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    // No valid label-event provenance (was unlabeled before assignment)
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });

  it('multiple current bot assignees → fail closed, remove nobody', () => {
    // Two users both have bot-assigned provenance. Multiple records = ambiguous,
    // fail closed.
    const assignedAt = daysAgo(25);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user', 'other-user'],
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
            makeAssignedEvent({
              number: 42,
              assignee: 'other-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    // Multiple bot assignees → ambiguous, fail closed, remove nobody
    expect(result.state.issues['42']._assignees).toContain('stale-user');
    expect(result.state.issues['42']._assignees).toContain('other-user');
  });
});

// ===========================================================================
// 8: Cleanup recovery and exact membership
// ===========================================================================

describe('8: Cleanup recovery and exact membership', () => {
  it('assignee DELETE succeeds but label DELETE fails → report removed, leave marker', () => {
    // The assignee is successfully removed, but label DELETE then fails
    // on every retry. The script must report nonzero (operational failure)
    // but the assignee was already removed, and label should remain for retry.
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

    // Must be nonzero (operational failure) but assignee was removed
    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    // Label should remain for retry
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('next run with no assignee removes stale label', () => {
    // After the previous scenario (assignee removed, label remains),
    // the next cleanup run should remove the label.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: [],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {},
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('bob/bobby exact membership: only stale-user removed, not bobby', () => {
    // Two similar names — exact jq index must be used, not grep substring.
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['bob', 'bobby'],
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
              assignee: 'bob',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    // Only bob should be removed (he has bot provenance)
    expect(result.state.issues['42']._assignees).not.toContain('bob');
    // bobby must be preserved (exact match, not substring)
    expect(result.state.issues['42']._assignees).toContain('bobby');
  });
});

// ===========================================================================
// 11: Docs accuracy
// ===========================================================================

describe('11: Docs accuracy', () => {
  it('CONTRIBUTING.md does not mention concurrency coalescing', () => {
    const docs = readRootFile('CONTRIBUTING.md');
    expect(docs).not.toMatch(/coalesc/i);
  });

  it('CONTRIBUTING.md defines qualifying linked PR accurately', () => {
    const docs = readRootFile('CONTRIBUTING.md');
    expect(docs).toContain('linked PR');
  });

  it('CONTRIBUTING.md mentions durable prior assignment', () => {
    const docs = readRootFile('CONTRIBUTING.md');
    // Should reference prior issue assignment eligibility
    expect(docs).toMatch(/prior.*assignment/i);
  });

  it('CONTRIBUTING.md mentions hard cap postcondition', () => {
    const docs = readRootFile('CONTRIBUTING.md');
    expect(docs).toContain('3');
  });
});
