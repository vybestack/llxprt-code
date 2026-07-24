/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the /assign GitHub Action automation.
 *
 * Per RULES.md: these tests execute the REAL bash scripts against a stateful
 * fake `gh` infrastructure adapter. They assert final issue state, comments,
 * exit status, and preservation/destructive behavior — not call counts or
 * mocked invocations.
 *
 * The fake gh (scripts/tests/fake-gh.py) models GitHub REST API state
 * transitions. It is infrastructure, not a business-logic mirror.
 */

import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { writeFileSync } from 'fs';
import * as nodePath from 'path';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.js';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  makeCrossRefEvent,
  daysAgo,
} from './assign-helpers.js';

// ---------------------------------------------------------------------------
// Workflow gate / config tests
// ---------------------------------------------------------------------------

describe('assign.yml workflow configuration', () => {
  const source = readRootFile('.github/workflows/assign.yml');
  const workflow = yaml.load(source);

  it('workflow has jobs defined', () => {
    expect(workflow.jobs, 'workflow should have jobs').toBeDefined();
    expect(workflow.jobs.assign, 'assign job should exist').toBeDefined();
  });

  const job = workflow.jobs?.assign;

  it('triggers on issue_comment created and issues assigned', () => {
    expect(workflow.on?.issue_comment?.types).toEqual(['created']);
    expect(workflow.on?.issues?.types).toEqual(['assigned']);
    expect(workflow.on?.pull_request).toBeUndefined();
  });

  it('uses least-privilege permissions including pull-requests read', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      issues: 'write',
      'pull-requests': 'read',
    });
  });

  it('gates on exact /assign for issues (not PRs) and rejects bots', () => {
    expect(job, 'assign job should exist').toBeTruthy();
    const condition = normalize(job?.if ?? '');
    expect(condition).toContain('github.event.issue.pull_request == null');
    expect(condition).toContain("github.event.comment.user.type != 'Bot'");
    expect(condition).toContain("github.event.comment.body == '/assign'");
    expect(condition).toContain(
      `toJSON(github.event.comment.body) == '"/assign\\n"'`,
    );
    // Must not use startsWith
    expect(source).not.toMatch(
      /startsWith\(toJSON\(github\.event\.comment\.body\)/,
    );
  });

  it('groups concurrency by actor+issue to allow independent distinct issues', () => {
    // GitHub retains only one pending job per concurrency group. Commenter-
    // ID-only grouping would cancel a valid /assign on a distinct issue.
    // Grouping by actor+issue allows distinct-issue commands to run
    // independently. The real-script post-mutation cap enforcement/election
    // remains authoritative for bounding total assignments.
    expect(job?.concurrency).toEqual({
      group:
        'assign-${{ github.event.comment.user.id }}-${{ github.event.issue.number }}',
      'cancel-in-progress': false,
    });
  });

  it('passes env vars and runs the script', () => {
    const runStep = job?.steps?.find(
      (s) => s.name === 'Run assign-issue script',
    );
    expect(runStep, 'Run assign-issue script step should exist').toBeTruthy();
    expect(runStep?.run).toContain('./.github/scripts/assign-issue.sh');
    expect(runStep?.env?.ISSUE_NUMBER).toBe('${{ github.event.issue.number }}');
    expect(runStep?.env?.COMMENTER_LOGIN).toBe(
      '${{ github.event.comment.user.login }}',
    );
    expect(runStep?.env?.GH_TOKEN).toBe('${{ github.token }}');
  });
});

describe('assign.yml record-history job', () => {
  const workflow = yaml.load(readRootFile('.github/workflows/assign.yml'));

  it('workflow has a record-history job', () => {
    expect(workflow.jobs, 'workflow should have jobs').toBeDefined();
    expect(
      workflow.jobs['record-history'],
      'record-history job should exist',
    ).toBeDefined();
  });

  const job = workflow.jobs?.['record-history'];

  it('has a record-history job that fires on issues:assigned events', () => {
    expect(job, 'record-history job should exist').toBeTruthy();
    expect(normalize(job?.if ?? '')).toContain("github.event_name == 'issues'");
    expect(normalize(job?.if ?? '')).toContain(
      "github.event.action == 'assigned'",
    );
  });

  it('uses least-privilege permissions', () => {
    expect(job?.permissions).toEqual({
      contents: 'read',
      issues: 'write',
    });
  });

  it('validates login from event payload and delegates to record-history script', () => {
    const runStep = job?.steps?.find(
      (s) => s.name === 'Record assignment-history label',
    );
    expect(
      runStep,
      'Record assignment-history label step should exist',
    ).toBeTruthy();
    expect(runStep?.env?.ASSIGNEE_LOGIN).toBe(
      '${{ github.event.assignee.login }}',
    );
    const runText = normalize(runStep?.run ?? '');
    // Must invoke the extracted record-history script
    expect(runText).toContain('record-assignment-history.sh');
    // Must NOT contain inline label creation logic (delegated to script)
    expect(runStep?.run).not.toMatch(/\/issues\/\d+\/labels/);
  });

  it('serializes record-history per stable assignee ID without cancelling in progress', () => {
    // Per-assignee concurrency bounds fan-out for the same user's assignment
    // events while allowing independent assignees to proceed. In-flight runs
    // complete rather than being cancelled (avoid partial label state).
    expect(job?.concurrency).toEqual({
      group: 'record-history-${{ github.event.assignee.id }}',
      'cancel-in-progress': false,
    });
  });
});

describe('assign-stale-cleanup.yml workflow configuration', () => {
  const source = readRootFile('.github/workflows/assign-stale-cleanup.yml');
  const workflow = yaml.load(source);

  it('workflow has a cleanup job', () => {
    expect(workflow.jobs, 'workflow should have jobs').toBeDefined();
    expect(workflow.jobs.cleanup, 'cleanup job should exist').toBeDefined();
  });

  const job = workflow.jobs?.cleanup;

  it('runs on a daily schedule and workflow_dispatch', () => {
    expect(workflow.on?.schedule?.[0]?.cron).toBe('0 7 * * *');
    expect(workflow.on?.workflow_dispatch).toBeDefined();
  });

  it('guards scheduled runs to the canonical upstream repository', () => {
    expect(normalize(job?.if ?? '')).toContain(
      "github.repository == 'vybestack/llxprt-code'",
    );
    expect(normalize(job?.if ?? '')).not.toContain('llpxrt-code');
  });
});

// ---------------------------------------------------------------------------
// assign-issue.sh behavioral tests
// ---------------------------------------------------------------------------

describe('assign-issue.sh behavioral', () => {
  it('assigns a user with a merged PR', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
        prs: {
          100: makePR({
            number: 100,
            author: 'alice',
            merged: true,
            mergedAt: '2025-06-15T00:00:00Z',
          }),
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    const issue = result.state.issues['42'];
    expect(issue._assignees).toContain('alice');
    expect(issue._label_names).toContain('auto-assigned');
    // Should have posted a success feedback comment by the bot
    const feedbackComments = result.state.comments.filter(
      (c) =>
        c.issue_number === 42 &&
        c.user.login === 'github-actions[bot]' &&
        c.body.includes('<!-- llxprt-assign-feedback -->'),
    );
    expect(feedbackComments.length).toBeGreaterThanOrEqual(1);
    expect(feedbackComments[0].body).toContain('Assigned');
    expect(feedbackComments[0].user.login).toBe('github-actions[bot]');
  });

  it('assigns a user in the assignment-history backfill file', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
      }),
    );
    const historyPath = nodePath.join(repo.dir, 'assignment-history.txt');
    writeFileSync(historyPath, ['alice', 'bob', 'charlie'].join('\n') + '\n');
    const result = repo.runAssign({
      issueNumber: 42,
      commenter: 'bob',
      extraEnv: { ASSIGNMENT_HISTORY_FILE: historyPath },
    });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('bob');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('assigns a user with a history label (per-login O(1) lookup)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
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

  it('refuses to assign when issue is already assigned', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: ['someone-else'] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Exit 0 (expected refusal, posts feedback)
    expect(result.status).toBe(0);
    // alice NOT assigned
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    // Original assignee preserved
    expect(result.state.issues['42']._assignees).toContain('someone-else');
    // Feedback posted
    const comments = result.state.comments.filter((c) => c.issue_number === 42);
    expect(comments.some((c) => c.body.includes('already assigned'))).toBe(
      true,
    );
  });

  it('refuses to assign when user is at the 3-issue cap', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
          1: makeIssue({ number: 1, assignees: ['alice'] }),
          2: makeIssue({ number: 2, assignees: ['alice'] }),
          3: makeIssue({ number: 3, assignees: ['alice'] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    const comments = result.state.comments.filter((c) => c.issue_number === 42);
    expect(comments.some((c) => c.body.includes('open assigned issues'))).toBe(
      true,
    );
    expect(comments.some((c) => c.body.includes('maximum is'))).toBe(true);
  });

  it('refuses ineligible user with no merged PR and no prior assignment', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'newbie' });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('newbie');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
    const comments = result.state.comments.filter((c) => c.issue_number === 42);
    expect(comments.some((c) => c.body.includes('eligibility requires'))).toBe(
      true,
    );
  });

  it('fails closed (nonzero, no mutation) when guard API fails', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
        // Fail the issue view (already-assigned guard)
        fail_config: { 'repos/test/repo/issues/42': 'error' },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    // Must be nonzero — infrastructure failure
    expect(result.status).not.toBe(0);
    // No mutation
    expect(result.state.issues['42']._assignees).toEqual([]);
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('atomic assignee+label transition preserves existing labels', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: [],
            labels: ['bug', 'help wanted'],
          }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    const issue = result.state.issues['42'];
    expect(issue._assignees).toContain('alice');
    // Original labels preserved + new auto-assigned added
    expect(issue._label_names).toContain('bug');
    expect(issue._label_names).toContain('help wanted');
    expect(issue._label_names).toContain('auto-assigned');
  });

  it('sticky feedback lookup only selects bot-authored marker comments', () => {
    // A user-authored comment containing the marker should not be hijacked
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: ['someone-else'] }),
        },
        comments: [
          {
            id: 999,
            issue_number: 42,
            body: '<!-- llxprt-assign-feedback -->\nUser-injected marker',
            user: { login: 'malicious-user', type: 'User' },
            created_at: '2025-07-20T00:00:00Z',
            updated_at: '2025-07-20T00:00:00Z',
          },
        ],
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    // The user-authored comment must NOT be updated
    const userComment = result.state.comments.find((c) => c.id === 999);
    expect(userComment.body).toBe(
      '<!-- llxprt-assign-feedback -->\nUser-injected marker',
    );
    // A NEW bot comment should be posted (not updating the user's)
    const botComments = result.state.comments.filter(
      (c) => c.issue_number === 42 && c.user.login === 'github-actions[bot]',
    );
    expect(botComments.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// unassign-stale-issues.sh behavioral tests
// ---------------------------------------------------------------------------

describe('unassign-stale-issues.sh behavioral', () => {
  it('preserves manual co-assignees when removing stale bot-assignee', () => {
    const assignedAt = daysAgo(20); // 20 days ago, > 14 day threshold
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user', 'manual-contributor'],
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
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    const issue = result.state.issues['42'];
    // stale-user removed, manual-contributor preserved
    expect(issue._assignees).not.toContain('stale-user');
    expect(issue._assignees).toContain('manual-contributor');
  });

  it('never unassigns acoliver', () => {
    const assignedAt = daysAgo(30);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['acoliver'],
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
              assignee: 'acoliver',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('acoliver');
  });

  it('removes stale bot-assignee with no qualifying linked PR', () => {
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
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('retains recent assignment (younger than 14 days)', () => {
    const assignedAt = daysAgo(5);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['recent-user'],
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
              assignee: 'recent-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('recent-user');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('retains assignment when a qualifying linked PR exists after assignment', () => {
    const assignedAt = daysAgo(20);
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
            // Cross-reference: a PR by active-user linked 5 days after assignment
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
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('preserves state and reports nonzero when timeline query fails', () => {
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
        fail_config: {
          'repos/test/repo/issues/42/timeline': 'error',
        },
      }),
    );

    const result = repo.runCleanup();

    // Must report nonzero (unknown state, preserve)
    expect(result.status).not.toBe(0);
    // State preserved — no destructive cleanup
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });

  it('removes no human assignee when there is no bot-assigned provenance', () => {
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['manually-assigned-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            // Assigned by a human, NOT github-actions[bot]
            makeAssignedEvent({
              number: 42,
              assignee: 'manually-assigned-user',
              actor: 'some-admin',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    // The manually-assigned user must NOT be unassigned
    expect(result.state.issues['42']._assignees).toContain(
      'manually-assigned-user',
    );
  });

  it(
    'paginates candidate discovery beyond one page',
    { timeout: 60000 },
    () => {
      // Create >30 issues (default page size) to force pagination
      const issues = {};
      const timeline = {};
      for (let i = 1; i <= 35; i++) {
        issues[String(i)] = makeIssue({
          number: i,
          assignees: [`user-${i}`],
          labels: ['auto-assigned'],
        });
        timeline[String(i)] = [
          makeLabeledEvent({
            label: 'auto-assigned',
            actor: 'github-actions[bot]',
            createdAt: daysAgo(20),
          }),
          makeAssignedEvent({
            number: i,
            assignee: `user-${i}`,
            actor: 'github-actions[bot]',
            createdAt: daysAgo(20),
          }),
        ];
      }

      const repo = createFakeRepo(defaultStateWith({ issues, timeline }));

      const result = repo.runCleanup();

      // All 35 should be discovered and processed (pagination works)
      expect(result.status).toBe(0);
      // Verify issues from the second page (31-35) were processed
      for (let i = 31; i <= 35; i++) {
        expect(result.state.issues[String(i)]._assignees).not.toContain(
          `user-${i}`,
        );
      }
    },
    30000,
  );
});

// ---------------------------------------------------------------------------
// CONTRIBUTING.md docs test
// ---------------------------------------------------------------------------

describe('CONTRIBUTING.md self-assign docs', () => {
  it('documents /assign eligibility, cap, and stale cleanup without OWNER/MEMBER', () => {
    const docs = readRootFile('CONTRIBUTING.md');
    expect(docs).toContain('/assign');
    expect(docs).toContain('merged PR');
    expect(docs).toContain('3');
    expect(docs).toContain('auto-assigned');
    expect(docs).toContain('2 weeks');
    // Must NOT mention trusted-contributors or OWNER/MEMBER/COLLABORATOR
    // as eligibility paths
    expect(docs).not.toContain('trusted-contributors');
    // Check the self-assign section specifically doesn't mention
    // owner/member/collaborator as eligibility
    const selfAssignSection = docs.match(
      /### Self Assigning Issues[\s\S]*?(?=\n### )/,
    );
    expect(
      selfAssignSection,
      'Self Assigning Issues section should exist',
    ).toBeTruthy();
    const sectionText = normalize(selfAssignSection[0]);
    expect(sectionText).not.toMatch(/\bowner\b|\bmember\b|\bcollaborator\b/i);
    // Must not claim write access is the only cause of assignment failure
    expect(sectionText).not.toContain('write access is the only');
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}
