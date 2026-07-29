/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 deep-review remediation findings.
 * Part B: describe blocks D, E, F, and Backfill — split from
 * assign-remediation2.test.ts to satisfy the 800line limit.
 *
 * These execute the REAL bash scripts against the fake gh infrastructure.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import * as nodePath from 'path';
import {
  asRecord,
  asRecordMap,
  parseWorkflowYaml,
  stateIssue,
  statePr,
} from './typed-test-helpers.ts';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  makeCrossRefEvent,
  daysAgo,
} from './assign-helpers.ts';
function defaultStateWith(overrides: Record<string, unknown>) {
  return { ...defaultState(), ...overrides };
}

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
    expect(stateIssue(result.state, '42')._assignees).toContain('active-user');
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

    expect(result.status).toBe(0);
    expect(stateIssue(result.state, '42')._assignees).not.toContain(
      'stale-user',
    );
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

    expect(result.status).toBe(0);
    expect(stateIssue(result.state, '42')._assignees).not.toContain(
      'stale-user',
    );
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

    expect(result.status).toBe(0);
    expect(stateIssue(result.state, '42')._assignees).not.toContain(
      'stale-user',
    );
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
    repo.updateState((s) => {
      asRecord(s.prs['99'])._assignees = ['newbie'];
    });
    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'newbie',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: '/nonexistent' },
    });

    expect(stateIssue(result.state, '42')._assignees).not.toContain('newbie');
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
    repo.updateState((s) => {
      const pr99 = asRecord(s.prs['99']);
      pr99._label_names = ['auto-assigned'];
      pr99._assignees = ['someone'];
    });

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(statePr(result.state, '99')._assignees).toContain('someone');
    expect(statePr(result.state, '99')._label_names).toContain('auto-assigned');
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
    const workflow = parseWorkflowYaml(source);
    const jobs = asRecordMap(workflow['jobs']);
    expect(jobs, 'workflow should have jobs').toBeDefined();
    expect(jobs['assign'], 'assign job should exist').toBeDefined();
    expect(jobs['assign']['concurrency']).toEqual({
      group:
        'assign-${{ github.event.comment.user.id }}-${{ github.event.issue.number }}',
      'cancel-in-progress': false,
    });
  });

  it('race: concurrent assignment pushes over cap, rollback occurs', () => {
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
    expect(stateIssue(result.state, '42')._assignees).not.toContain('alice');
    // #50 should still have alice (that was the concurrent assignment)
    expect(stateIssue(result.state, '50')._assignees).toContain('alice');
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
    expect(lines.every((l) => l.trim().length > 0)).toBe(true);
    expect(lines.every((l) => !l.endsWith('[bot]'))).toBe(true);
    const sorted = [...lines].sort();
    expect(lines).toEqual(sorted);
    expect(new Set(lines).size).toBe(lines.length);
  });
});
