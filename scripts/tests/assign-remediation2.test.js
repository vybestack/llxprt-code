/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 deep-review remediation findings.
 *
 * These tests target the specific architectural requirements:
 *   A: No repository-wide events scan; backfill + history label
 *   B: Targeted REST mutations (POST/DELETE, not whole-array PATCH)
 *   C: Corrected cleanup provenance (human reassignment not mistaken for bot)
 *   D: Cross-reference same-repo qualification
 *   E: PR filtering from all issue paths
 *   F: Per-issue concurrency and post-cap rollback
 *
 * These execute the REAL bash scripts against the fake gh infrastructure.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as nodePath from 'path';
import yaml from 'js-yaml';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  makeUnassignedEvent,
  makeCrossRefEvent,
  daysAgo,
  failOnNth,
} from './assign-helpers.js';

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}

function writeBackfill(repo, logins) {
  const filePath = nodePath.join(repo.dir, 'assignment-history.txt');
  writeFileSync(filePath, logins.join('\n') + '\n');
  return filePath;
}

// ===========================================================================
// A: No repository-wide events scan; backfill + history label
// ===========================================================================

describe('A: Durable indexed history (no events scan)', () => {
  it('current NON-PR issue assignment qualifies (cheap search first)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
          50: makeIssue({ number: 50, assignees: ['bob'] }),
        },
      }),
    );
    // No backfill, no history label — but bob is currently assigned to #50
    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'bob',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('bob');
  });

  it('static backfill exact-line lookup qualifies', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
      }),
    );
    const historyFile = writeBackfill(repo, ['alice', 'bob', 'charlie']);
    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'bob',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: historyFile },
    });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('bob');
  });

  it('backfill does not match substrings (exact-line only)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
      }),
    );
    // 'bob' should NOT match 'bobby'
    const historyFile = writeBackfill(repo, ['bobby', 'alice']);
    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'bob',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: historyFile },
    });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('bob');
  });

  it('per-login history label O(1) GET qualifies', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: '0E8A16',
            description: 'Assigned via /assign automation',
          },
          'asnhist--bob': {
            name: 'asnhist--bob',
            color: '0E8A16',
            description: 'Issue assignment history index',
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

  it('current PR assignment does NOT qualify (is:issue filter)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: {
          99: makePR({ number: 99, author: 'newbie', merged: false }),
        },
      }),
    );
    // newbie is assigned to PR #99 but not to any issue
    repo.updateState((s) => {
      s.prs['99']._assignees = ['newbie'];
    });
    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'newbie',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    // Should be refused — PR assignment doesn't qualify
    expect(result.state.issues['42']._assignees).not.toContain('newbie');
  });

  it('merged PR still qualifies (independent of history)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: {
          100: makePR({ number: 100, author: 'contributor', merged: true }),
        },
      }),
    );
    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'contributor',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('contributor');
  });
});

// ===========================================================================
// B: Targeted REST mutations (POST/DELETE, not whole-array PATCH)
// ===========================================================================

describe('B: Targeted REST mutations', () => {
  it('preserves comma-bearing labels during assignment', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: [],
            labels: ['priority: high, urgent'],
          }),
        },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    const issue = result.state.issues['42'];
    expect(issue._assignees).toContain('alice');
    expect(issue._label_names).toContain('auto-assigned');
    // Comma-bearing label preserved exactly
    expect(issue._label_names).toContain('priority: high, urgent');
  });

  it('preserves comma-bearing labels during cleanup', () => {
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned', 'priority: high, urgent'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
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
    const issue = result.state.issues['42'];
    expect(issue._assignees).not.toContain('stale-user');
    expect(issue._label_names).not.toContain('auto-assigned');
    // Comma-bearing label preserved exactly
    expect(issue._label_names).toContain('priority: high, urgent');
  });

  it('preserves human co-assignee added between read and mutation', () => {
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
        side_effects: [
          {
            method: 'DELETE',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            action: 'add_assignee',
            issue: 42,
            assignee: 'human-contributor',
          },
        ],
      }),
    );

    const result = repo.runCleanup();

    // Targeted DELETE removed stale-user; the fresh human-contributor
    // assignment survives because the DELETE is login-targeted.
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    expect(result.state.issues['42']._assignees).toContain('human-contributor');
    // J1 reconciliation: a fresh assignment transition appeared after the
    // pre-delete snapshot, so the auto-assigned marker is preserved and
    // the cleanup reports nonzero (retained state for reconciliation).
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    expect(result.status).not.toBe(0);
  });

  it('preserves human label added between read and mutation', () => {
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
        side_effects: [
          {
            method: 'DELETE',
            endpoint: 'repos/test/repo/issues/42/labels/auto-assigned',
            on_nth: 1,
            action: 'add_label',
            issue: 42,
            label: 'human-added-label',
          },
        ],
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
    // Human-added label must survive
    expect(result.state.issues['42']._label_names).toContain(
      'human-added-label',
    );
  });

  it('silently drops unassignable user and rolls back label', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        unassignable_logins: ['alice'],
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // alice was silently dropped (no collaborator access)
    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // Label should have been rolled back
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('rolls back label when assignee POST fails (partial state)', () => {
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
    // Label was added then rolled back
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('post-mutation cap rollback removes only this run assignee', () => {
    // Alice starts at the cap. The assignee POST also injects an unrelated
    // concurrent assignee on issue 1; after Alice is added to #42, her own
    // open count exceeds the cap and only this run's assignment is rolled back.
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
          1: makeIssue({ number: 1, assignees: ['alice'] }),
          2: makeIssue({ number: 2, assignees: ['alice'] }),
          3: makeIssue({ number: 3, assignees: ['alice'] }),
        },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        side_effects: [
          {
            method: 'POST',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            action: 'add_assignee',
            issue: 1,
            assignee: 'concurrent-user',
          },
        ],
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // alice has 3 already + 1 from our POST = 4 > 3
    // Should roll back alice from #42
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // auto-assigned label should also be rolled back
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('jq @uri encodes special-character label names for DELETE', () => {
    // The cleanup script uses `jq -sRr '@uri'` to URL-encode label names.
    // This verifies that space and slash in label names are properly encoded
    // so the DELETE endpoint receives the correct path. The raw+slurp mode
    // produces a single string (not an array), which is the correct behavior
    // for @uri. The label under test is 'priority: high/urgent' (space + slash).
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned', 'priority: high/urgent'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
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
    // auto-assigned was removed
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
    // Special-character label survives (was not accidentally removed by
    // malformed URL encoding)
    expect(result.state.issues['42']._label_names).toContain(
      'priority: high/urgent',
    );
  });
});

// ===========================================================================
// C: Corrected cleanup provenance
// ===========================================================================

describe('C: Cleanup provenance (human reassignment not bot)', () => {
  it('bot assigned, human unassigned, human reassigned — never remove', () => {
    const botAssignedAt = daysAgo(25);
    const humanUnassignedAt = daysAgo(20);
    const humanReassignedAt = daysAgo(15);

    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['someuser'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            makeLabeledEvent({
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: botAssignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'someuser',
              actor: 'github-actions[bot]',
              createdAt: botAssignedAt,
            }),
            makeUnassignedEvent({
              number: 42,
              assignee: 'someuser',
              actor: 'human-admin',
              createdAt: humanUnassignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'someuser',
              actor: 'human-admin',
              createdAt: humanReassignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    // The latest transition for someuser is assigned by human, NOT bot
    // So this is NOT an automated assignment — must NOT remove
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('someuser');
  });

  it('bot assigned only (latest transition is bot) — eligible for removal', () => {
    const botAssignedAt = daysAgo(25);
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
              createdAt: botAssignedAt,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: botAssignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });

  it('bot assigned, bot unassigned, bot reassigned — latest is bot assign, eligible', () => {
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
              createdAt: daysAgo(25),
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(25),
            }),
            makeUnassignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(20),
            }),
            makeLabeledEvent({
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(15),
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: daysAgo(15),
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    // Latest transition is bot-assigned → eligible for removal
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });
});

// ===========================================================================
// D: Cross-reference same-repo qualification
// ===========================================================================

describe('D: Cross-reference same-repo qualification', () => {
  it('same-repo PR by assignee after assignment — retains', () => {
    const assignedAt = daysAgo(25);
    const repo = createFakeRepo(
      defaultStateWith({
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
            makeCrossRefEvent({
              number: 42,
              prNumber: 200,
              prAuthor: 'active-user',
              createdAt: daysAgo(20),
              repositoryUrl: 'https://api.github.com/repos/test/repo',
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('active-user');
  });

  it('cross-repo PR by assignee — does NOT qualify, unassigns', () => {
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
            makeCrossRefEvent({
              number: 42,
              prNumber: 200,
              prAuthor: 'stale-user',
              createdAt: daysAgo(20),
              repositoryUrl: 'https://api.github.com/repos/other/fork',
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    // Cross-repo PR does NOT qualify — should unassign
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });

  it('PR author does not match assignee — does NOT qualify', () => {
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
            makeCrossRefEvent({
              number: 42,
              prNumber: 200,
              prAuthor: 'someone-else',
              createdAt: daysAgo(20),
              repositoryUrl: 'https://api.github.com/repos/test/repo',
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    // PR author != assignee → does NOT qualify → unassigns
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });

  it('PR linked before assignment — does NOT qualify', () => {
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
            // PR linked BEFORE assignment
            makeCrossRefEvent({
              number: 42,
              prNumber: 200,
              prAuthor: 'stale-user',
              createdAt: daysAgo(25),
              repositoryUrl: 'https://api.github.com/repos/test/repo',
            }),
            makeLabeledEvent({
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

    // PR was linked before the assignment → does NOT qualify → unassigns
    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });
});

// ===========================================================================
// E: PR filtering from all issue paths
// ===========================================================================

describe('E: PR filtering', () => {
  it('PR assignment does NOT qualify for /assign eligibility', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: {
          99: makePR({ number: 99, author: 'newbie', merged: false }),
        },
      }),
    );
    // Assign newbie to a PR (not an issue)
    repo.updateState((s) => {
      s.prs['99']._assignees = ['newbie'];
    });
    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'newbie',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    expect(result.state.issues['42']._assignees).not.toContain('newbie');
  });

  it('PR with auto-assigned label never enters cleanup', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {},
        prs: {
          99: makePR({ number: 99, author: 'someone', merged: false }),
        },
      }),
    );
    // Put auto-assigned label on a PR
    repo.updateState((s) => {
      s.prs['99']._label_names = ['auto-assigned'];
      s.prs['99']._assignees = ['someone'];
    });

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    // PR should not be processed by cleanup (discover_candidates filters PRs)
    expect(result.state.prs['99']._assignees).toContain('someone');
    expect(result.state.prs['99']._label_names).toContain('auto-assigned');
  });
});

// ===========================================================================
// F: Per-issue concurrency and post-cap rollback
// ===========================================================================

describe('F: Per-issue concurrency and post-cap rollback', () => {
  it('groups concurrency by commenter ID AND issue number to allow independent distinct issues', () => {
    const source = readFileSync(
      nodePath.join(
        import.meta.dirname,
        '../..',
        '.github/workflows/assign.yml',
      ),
      'utf8',
    );
    const workflow = yaml.load(source);
    expect(workflow.jobs, 'workflow should have jobs').toBeDefined();
    expect(workflow.jobs.assign, 'assign job should exist').toBeDefined();
    expect(workflow.jobs.assign.concurrency).toEqual({
      group:
        'assign-${{ github.event.comment.user.id }}-${{ github.event.issue.number }}',
      'cancel-in-progress': false,
    });
  });

  it('race: concurrent assignment pushes over cap, rollback occurs', () => {
    // alice has 2 open issues. Our run will assign her to #42 (making 3).
    // But a side_effect on the POST will also assign her to #50 (making 4).
    // After our mutation, the post-mutation cap check should roll back.
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

    // Post-mutation: alice has 4 open issues (1, 2, 42, 50) > 3
    // Should roll back alice from #42
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // #50 should still have alice (that was the concurrent assignment)
    expect(result.state.issues['50']._assignees).toContain('alice');
  });
});

// ===========================================================================
// Backfill file structure tests
// ===========================================================================

describe('Backfill file semantics', () => {
  it('.github/assignment-history.txt exists and is sorted unique', () => {
    const filePath = nodePath.join(
      import.meta.dirname,
      '../..',
      '.github/assignment-history.txt',
    );
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    // All lines non-empty
    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
    // No bots
    expect(lines.every((l) => !l.endsWith('[bot]'))).toBe(true);
    // Sorted
    const sorted = [...lines].sort();
    expect(lines).toEqual(sorted);
    // Unique
    expect(new Set(lines).size).toBe(lines.length);
  });
});
