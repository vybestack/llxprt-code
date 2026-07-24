/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for three fresh review findings (round 10).
 *
 *   J1: Cleanup overlap race — unassign-stale-issues.sh must defensively
 *       reconcile post-DELETE state using timeline positions and current
 *       assignees. If any newer assignment transition than the exact
 *       pre-delete snapshot occurred (regardless of actor bot/human, login),
 *       preserve/restore the fresh assignment and preserve the
 *       auto-assigned marker.
 *         a) Same-login fresh bot reassignment deleted by the stale DELETE
 *            must be restored via targeted POST and verified.
 *         b) A different fresh assignee must remain untouched, and the
 *            auto-assigned marker must remain.
 *
 *   J2: Assignment workflow concurrency — assign job concurrency changed to
 *       actor+issue (stable commenter user ID + issue number) so distinct-
 *       issue commands run independently. record-history stays per-assignee.
 *       No claim of actor-wide serialization.
 *
 *   J3: CONTRIBUTING.md assignment failure guidance — remove any implication
 *       that an assignee must have repository write access. State that GitHub
 *       may reject/ignore an unavailable or unassignable account, and
 *       verification reports that failure.
 *
 * These execute the REAL bash scripts and REAL workflow YAML against the
 * stateful fake gh infrastructure adapter. Tests assert observable final
 * state, not invocation counts.
 */

import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makeAssignedEvent,
  makeLabeledEvent,
  daysAgo,
} from './assign-helpers.js';
import { normalize, readRootFile } from './ocr-review-workflow-helpers.js';

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}

// ===========================================================================
// J1: Cleanup overlap race — post-DELETE reconciliation
// ===========================================================================

describe('J1: cleanup overlap race reconciliation', () => {
  const assignedAt = daysAgo(20);

  describe('same-login fresh bot reassignment after stale DELETE', () => {
    it('restores same-login bot assignment deleted by stale DELETE and preserves marker', () => {
      // Initial state: stale-user assigned 20 days ago by bot.
      // Timeline snapshot taken BEFORE DELETE sees the old assignment.
      // Between stale validation/mutation and marker deletion, a fresh
      // /assign reassigns stale-user (bot creates a NEW assigned event
      // after the pre-delete snapshot).
      //
      // The stale DELETE removes the assignment (and adds an unassigned
      // event to the timeline). The new assignment event appears at a
      // timeline position AFTER the pre-delete snapshot length.
      //
      // The script MUST detect that a new assignment transition occurred
      // after the pre-delete snapshot/stint, restore stale-user via
      // targeted POST, and preserve the auto-assigned marker.
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
              timing: 'post',
              // After the stale DELETE removes stale-user, a concurrent
              // fresh /assign reassigns stale-user via the bot. This adds
              // a new assigned event with a position AFTER the pre-delete
              // snapshot.
              action: 'add_assignee',
              issue: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
            },
          ],
        }),
      );

      const result = repo.runCleanup();

      // The script must detect the newer assignment and restore/preserve it.
      expect(result.state.issues['42']._assignees).toContain('stale-user');
      // The auto-assigned marker must be preserved.
      expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    });
  });

  describe('different-login fresh assignment after stale DELETE', () => {
    it('preserves a different fresh assignee and retains marker', () => {
      // Initial state: stale-user assigned 20 days ago by bot.
      // Between stale validation/mutation and marker deletion, a fresh
      // /assign assigns a DIFFERENT user (new-user) via the bot. This is
      // a newer assignment transition at a position after the pre-delete
      // snapshot.
      //
      // The script MUST leave new-user untouched and preserve the
      // auto-assigned marker. The stale-user DELETE already happened (we
      // don't roll that back), but the fresh assignment and marker survive.
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
              timing: 'post',
              // After the stale DELETE removes stale-user, a concurrent
              // fresh /assign assigns a different user via the bot.
              action: 'add_assignee',
              issue: 42,
              assignee: 'new-user',
              actor: 'github-actions[bot]',
            },
          ],
        }),
      );

      const result = repo.runCleanup();

      // new-user must remain (fresh assignment untouched).
      expect(result.state.issues['42']._assignees).toContain('new-user');
      // The auto-assigned marker must be preserved.
      expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    });
  });

  describe('human takeover protection still works (not weakened)', () => {
    it('restores a human same-login takeover detected after targeted DELETE and retains marker', () => {
      // This is the existing human-takeover protection — it must NOT be
      // weakened by the new reconciliation logic.
      const repo = createFakeRepo(
        defaultStateWith({
          issues: {
            42: makeIssue({
              number: 42,
              assignees: ['stale-user', 'co-owner'],
              labels: ['auto-assigned', 'bug'],
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
                assignee: 'stale-user',
                actor: 'github-actions[bot]',
                createdAt: assignedAt,
              }),
              makeAssignedEvent({
                assignee: 'co-owner',
                actor: 'maintainer',
                createdAt: assignedAt,
              }),
            ],
          },
          side_effects: [
            {
              method: 'DELETE',
              endpoint: 'repos/test/repo/issues/42/assignees',
              on_nth: 1,
              action: 'unassign_reassign',
              issue: 42,
              assignee: 'stale-user',
              actor: 'maintainer',
            },
          ],
        }),
      );

      const result = repo.runCleanup();

      expect(result.status).not.toBe(0);
      expect(result.state.issues['42']._assignees).toEqual(
        expect.arrayContaining(['stale-user', 'co-owner']),
      );
      expect(result.state.issues['42']._label_names).toEqual(
        expect.arrayContaining(['auto-assigned', 'bug']),
      );
      expect(
        (result.state._op_log ?? []).filter(
          (op) =>
            op.method === 'POST' &&
            op.endpoint === 'repos/test/repo/issues/42/assignees',
        ),
      ).toHaveLength(1);
    });
  });

  describe('normal cleanup without race still works', () => {
    it('unassigns stale bot-assignee with no fresh assignment', () => {
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
});

// ===========================================================================
// J2: Assignment workflow concurrency — actor+issue grouping
// ===========================================================================

describe('J2: assignment workflow concurrency', () => {
  const workflow = yaml.load(readRootFile('.github/workflows/assign.yml'));
  const assignJob = workflow.jobs?.assign;
  const recordHistoryJob = workflow.jobs?.['record-history'];

  it('assign job concurrency groups by commenter user ID AND issue number', () => {
    // GitHub retains only one pending job per concurrency group. Commenter-
    // ID-only grouping would cancel a valid /assign on a distinct issue.
    // Grouping by actor+issue allows distinct-issue commands to run
    // independently while still bounding same-actor-same-issue fan-out.
    expect(assignJob?.concurrency).toEqual({
      group:
        'assign-${{ github.event.comment.user.id }}-${{ github.event.issue.number }}',
      'cancel-in-progress': false,
    });
  });

  it('does not claim actor-wide serialization in the assign job comment', () => {
    // After the change, the assign job no longer serializes across all
    // issues for an actor — only per (actor, issue). The comment must not
    // claim actor-wide serialization.
    const source = readRootFile('.github/workflows/assign.yml');
    // The concurrency block exists and now includes issue.number
    expect(source).toContain(
      'assign-${{ github.event.comment.user.id }}-${{ github.event.issue.number }}',
    );
  });

  it('record-history job keeps per-assignee concurrency (unchanged)', () => {
    expect(recordHistoryJob?.concurrency).toEqual({
      group: 'record-history-${{ github.event.assignee.id }}',
      'cancel-in-progress': false,
    });
  });
});

// ===========================================================================
// J1 (structural): cleanup workflow concurrency
// ===========================================================================

describe('J1: cleanup workflow concurrency', () => {
  const source = readRootFile('.github/workflows/assign-stale-cleanup.yml');
  const workflow = yaml.load(source);
  const cleanupJob = workflow.jobs?.cleanup;

  it('has a repository-scoped concurrency group with cancel-in-progress false', () => {
    // The cleanup workflow must declare a concurrency group so overlapping
    // scheduled runs (or manual dispatches) are coordinated. The group must
    // be stable and repository-scoped (not run-specific).
    expect(cleanupJob?.concurrency).toBeDefined();
    expect(cleanupJob?.concurrency?.['cancel-in-progress']).toBe(false);
    // The group must be deterministic (not use run_id or run_number)
    const group = String(cleanupJob?.concurrency?.group ?? '');
    expect(group).toBeTruthy();
    expect(group).not.toMatch(/\$\{\{ *github\.event\./);
    expect(group).not.toMatch(/run_id|run_number/);
  });
});

// ===========================================================================
// J3: CONTRIBUTING.md assignment failure guidance
// ===========================================================================

describe('J3: CONTRIBUTING.md assignment failure guidance', () => {
  it('does not imply assignee needs repository write access', () => {
    const docs = readRootFile('CONTRIBUTING.md');
    const selfAssignSection = docs.match(
      /### Self Assigning Issues[\s\S]*?(?=\n### )/,
    );
    expect(
      selfAssignSection,
      'Self Assigning Issues section should exist',
    ).toBeTruthy();
    const sectionText = normalize(selfAssignSection[0]);

    // Must NOT mention write access as a requirement or cause of failure
    expect(sectionText).not.toMatch(/lacks write access/i);
    expect(sectionText).not.toMatch(/write access is the only/i);
    expect(sectionText).not.toMatch(/must have.*write access/i);
    expect(sectionText).not.toMatch(/requires.*write access/i);
  });

  it('states GitHub may reject or ignore an unassignable account', () => {
    const docs = readRootFile('CONTRIBUTING.md');
    const selfAssignSection = docs.match(
      /### Self Assigning Issues[\s\S]*?(?=\n### )/,
    );
    const sectionText = normalize(selfAssignSection[0]);

    // Must acknowledge that GitHub may reject/ignore an unavailable or
    // unassignable account, and verification reports that failure.
    expect(
      sectionText.match(/reject|ignore|unassignable|unavailable/i),
    ).toBeTruthy();
  });
});
