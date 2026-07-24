/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 Round 6 remediation findings.
 *
 *   H1: Closed assignment target — no assignee, marker, history, or success
 *       feedback on a closed issue. State validated at initial guard and
 *       again immediately before mutation. Closed = expected refusal (exit 0);
 *       malformed/missing state = infrastructure failure (exit 1).
 *   H2: Cleanup linked-PR race — one fresh pre-delete timeline snapshot
 *       validates BOTH provenance/marker correlation AND qualifying
 *       same-repo PR linkage immediately before DELETE.
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
  daysAgo,
} from './assign-helpers.js';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.js';

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}

// ===========================================================================
// H1: Closed assignment target
// ===========================================================================

describe('H1: Closed assignment target', () => {
  it('closed issue receives no assignee, label, history, or success feedback', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: [],
            state: 'closed',
          }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
    expect(result.state.labels['asnhist--alice']).toBeUndefined();
    const comments = result.state.comments.filter((c) => c.issue_number === 42);
    expect(comments.length).toBeGreaterThanOrEqual(1);
    expect(comments.some((c) => /closed|not open/i.test(c.body))).toBe(true);
    expect(comments.some((c) => /\[OK\] Assigned/.test(c.body))).toBe(false);
  });

  it('issue closed between initial guard and mutation (pre-mutation guard)', () => {
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
            on_nth: 5,
            action: 'set_state',
            issue: 42,
            state: 'closed',
          },
        ],
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
    expect(result.state.labels['asnhist--alice']).toBeUndefined();
    // User-facing feedback must be posted explaining the refusal
    const comments = result.state.comments.filter((c) => c.issue_number === 42);
    expect(comments.some((c) => /closed|not open/i.test(c.body))).toBe(true);
  });

  it('malformed issue state is infrastructure failure (exit 1)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: [],
            state: 'locked',
          }),
        },
        prs: {
          100: makePR({ number: 100, author: 'alice', merged: true }),
        },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).not.toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('alice');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('open issue still gets assigned normally (happy path)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({ number: 42, assignees: [] }),
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
    expect(result.state.labels['asnhist--alice']).toBeDefined();
  });

  it('assign.yml workflow gate includes issue.state == open', () => {
    const source = readRootFile('.github/workflows/assign.yml');
    const workflow = yaml.load(source);
    const condition = normalize(workflow.jobs?.assign?.if);
    expect(condition).toMatch(/github\.event\.issue\.state\s*==\s*'open'/);
  });
});

// ===========================================================================
// H2: Cleanup linked-PR race
// ===========================================================================

describe('H2: Cleanup linked-PR race', () => {
  it('qualifying PR appears before pre-delete revalidation → retain assignment', () => {
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
        side_effects: [
          {
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42/timeline',
            // The initial timeline snapshot serves both provenance and the
            // initial linked-PR check (one call instead of two). The fresh
            // pre-delete revalidation snapshot is the 2nd timeline GET — a
            // qualifying PR appearing there must block deletion.
            on_nth: 2,
            action: 'add_cross_ref',
            issue: 42,
            pr_number: 200,
            pr_author: 'stale-user',
            repo_url: 'https://api.github.com/repos/test/repo',
            created_at: daysAgo(15),
          },
        ],
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('stale-user');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
  });

  it('no qualifying PR appears → normal unassign (no false retain)', () => {
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
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });
});
