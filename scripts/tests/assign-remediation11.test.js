/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for four confirmed findings (round 11).
 *
 *   K1: HIGH marker race in unassign-stale-issues.sh — after cleanup's
 *       post-assignee-DELETE timeline snapshot, a fresh assignment can land
 *       and be visible in current assignees but not in that stale timeline.
 *       Cleanup deletes auto-assigned, leaving fresh assignee untracked.
 *       Tests cover all four race boundaries: after timeline response,
 *       after assignee read, immediately before label DELETE, and
 *       immediately after label DELETE. Pre-marker-delete reconciliation
 *       and post-marker-delete compensation must detect the fresh assignment
 *       and preserve/restore the marker.
 *
 *   K2: MEDIUM transition error in fresh_assignment_logins_after_snapshot —
 *       restores a login if any assigned event exists after snapshot, even
 *       if a later independent unassigned event removed it. Must use an
 *       ordered per-login transition model: restore only when latest
 *       transition is assigned AND cleanup's DELETE erased it.
 *
 *   K3: MEDIUM ambiguous marker POST in assign-issue.sh — if marker POST
 *       applies but returns error (applied_error), verification confirms
 *       presence but label_added_by_this_run stays false. Later assignee
 *       failure or signal leaves ownerless marker. Must track confirmed-
 *       present marker and perform ownership-aware rollback.
 *
 *   K4: LOW fake fidelity in fake-gh.py — nth counters increment once per
 *       matching rule instead of once per actual request. Must increment
 *       each request ordinal exactly once, then evaluate all rules against
 *       the immutable ordinal.
 *
 * These execute the REAL bash scripts and REAL fake-gh infrastructure
 * adapter. Tests assert observable final state.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as nodePath from 'path';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  daysAgo,
} from './assign-helpers.js';

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}

// ===========================================================================
// K1: Cleanup marker race — four boundary tests
// ===========================================================================

describe('K1: cleanup marker race boundaries', () => {
  const assignedAt = daysAgo(20);

  describe('fresh assignment after post-assignee-DELETE timeline response', () => {
    it('detects fresh assignment not in stale timeline and retains marker', () => {
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
              method: 'GET',
              endpoint: 'repos/test/repo/issues/42/timeline',
              on_nth: 3,
              timing: 'post',
              action: 'add_assignee',
              issue: 42,
              assignee: 'new-user',
              actor: 'github-actions[bot]',
            },
          ],
        }),
      );

      const result = repo.runCleanup();

      expect(result.state.issues['42']._assignees).toContain('new-user');
      expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    });
  });

  describe('fresh assignment after mid-assignee read', () => {
    it('detects fresh assignment not in stale assignee read and retains marker', () => {
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
              method: 'GET',
              endpoint: 'repos/test/repo/issues/42',
              on_nth: 2,
              timing: 'post',
              action: 'add_assignee',
              issue: 42,
              assignee: 'new-user',
              actor: 'github-actions[bot]',
            },
          ],
        }),
      );

      const result = repo.runCleanup();

      expect(result.state.issues['42']._assignees).toContain('new-user');
      expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    });
  });

  describe('fresh assignment immediately before label DELETE', () => {
    it('post-marker-delete compensation restores marker after pre-DELETE race', () => {
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
              endpoint: 'repos/test/repo/issues/42/labels/auto-assigned',
              on_nth: 1,
              timing: 'pre',
              action: 'add_assignee',
              issue: 42,
              assignee: 'new-user',
              actor: 'github-actions[bot]',
            },
          ],
        }),
      );

      const result = repo.runCleanup();

      expect(result.state.issues['42']._assignees).toContain('new-user');
      expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    });
  });

  describe('fresh assignment immediately after label DELETE', () => {
    it('post-marker-delete compensation restores marker after post-DELETE race', () => {
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
              endpoint: 'repos/test/repo/issues/42/labels/auto-assigned',
              on_nth: 1,
              timing: 'post',
              action: 'add_assignee',
              issue: 42,
              assignee: 'new-user',
              actor: 'github-actions[bot]',
            },
          ],
        }),
      );

      const result = repo.runCleanup();

      expect(result.state.issues['42']._assignees).toContain('new-user');
      expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    });
  });
});

// ===========================================================================
// K2: Transition model — assign→unassign must not restore
// ===========================================================================

describe('K2: ordered per-login transition model', () => {
  const assignedAt = daysAgo(20);

  it('does not restore same-login when latest independent transition is unassigned', () => {
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
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42/timeline',
            on_nth: 2,
            timing: 'post',
            action: 'add_assignee',
            issue: 42,
            assignee: 'stale-user',
            actor: 'github-actions[bot]',
          },
          {
            method: 'DELETE',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            timing: 'pre',
            action: 'unassign',
            issue: 42,
            assignee: 'stale-user',
            actor: 'human-user',
          },
        ],
      }),
    );

    const result = repo.runCleanup();

    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('does not restore different-login when latest independent transition is unassigned', () => {
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
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42/timeline',
            on_nth: 2,
            timing: 'post',
            action: 'add_assignee',
            issue: 42,
            assignee: 'new-user',
            actor: 'github-actions[bot]',
          },
          {
            method: 'DELETE',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            timing: 'pre',
            action: 'unassign',
            issue: 42,
            assignee: 'new-user',
            actor: 'human-user',
          },
        ],
      }),
    );

    const result = repo.runCleanup();

    expect(result.state.issues['42']._assignees).not.toContain('new-user');
    expect(result.state.issues['42']._label_names).not.toContain(
      'auto-assigned',
    );
  });
});

// ===========================================================================
// K3: Ambiguous marker POST — ownership-aware rollback
// ===========================================================================

describe('K3: ambiguous marker POST ownership-aware rollback', () => {
  it('removes label on assignee failure after applied-error label POST', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
        fail_config: {
          requests: [
            {
              method: 'POST',
              endpoint: 'repos/test/repo/issues/42/labels',
              on_nth: 1,
              type: 'applied_error',
            },
            {
              method: 'POST',
              endpoint: 'repos/test/repo/issues/42/assignees',
              on_nth: 1,
              type: 'error',
            },
          ],
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

  it(
    'removes label on TERM signal after applied-error label POST',
    { timeout: 30000 },
    () => {
      const hookFile = nodePath.join(
        process.cwd(),
        'tmp',
        `assign-signal-k3-${process.pid}`,
      );
      const repo = createFakeRepo(
        defaultStateWith({
          issues: { 42: makeIssue({ number: 42, assignees: [] }) },
          prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
          fail_config: {
            requests: [
              {
                method: 'POST',
                endpoint: 'repos/test/repo/issues/42/labels',
                on_nth: 1,
                type: 'applied_error',
              },
            ],
          },
          side_effects: [
            {
              method: 'POST',
              endpoint: 'repos/test/repo/issues/42/assignees',
              on_nth: 1,
              timing: 'post',
              action: 'pause',
              hook_file: hookFile,
              seconds: 0.5,
            },
          ],
        }),
      );
      const assignScript = nodePath.join(
        import.meta.dirname,
        '../..',
        '.github/scripts/assign-issue.sh',
      );
      const env = {
        ...process.env,
        GH_TOKEN: 'fake-token',
        GITHUB_TOKEN: 'fake-token',
        GITHUB_REPOSITORY: 'test/repo',
        ISSUE_NUMBER: '42',
        COMMENTER_LOGIN: 'alice',
        GH_FAKE_STATE: repo.stateFile,
        ASSIGN_ELECTION_DELAY: '0',
        PATH: `${repo.binDir}${nodePath.delimiter}${process.env.PATH}`,
        ASSIGN_SCRIPT: assignScript,
        SIGNAL_HOOK: hookFile,
      };

      let status = 0;
      try {
        execFileSync(
          'bash',
          [
            '-c',
            'rm -f "$SIGNAL_HOOK"; bash "$ASSIGN_SCRIPT" >/dev/null 2>&1 & pid=$!; found=false; for _ in $(seq 1 500); do if [[ -f "$SIGNAL_HOOK" ]]; then found=true; break; fi; sleep 0.01; done; if [[ "$found" != true ]]; then kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; exit 99; fi; kill -TERM "$pid"; wait "$pid"',
          ],
          { env, stdio: ['ignore', 'pipe', 'pipe'] },
        );
      } catch (error) {
        status = error.status ?? 1;
      }

      const state = repo.readState();
      expect(status).not.toBe(0);
      expect(state.issues['42']._label_names).not.toContain('auto-assigned');
    },
  );
});

// ===========================================================================
// K4: Fake-gh ordinal fidelity — once per request, shared across rules
// ===========================================================================

describe('K4: fake-gh ordinal fidelity', () => {
  it('multiple side-effect rules on one request all see ordinal 1', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        side_effects: [
          {
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42/timeline',
            on_nth: 1,
            timing: 'pre',
            action: 'add_label',
            issue: 42,
            label: 'rule-A',
          },
          {
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42/timeline',
            on_nth: 1,
            timing: 'pre',
            action: 'add_label',
            issue: 42,
            label: 'rule-B',
          },
        ],
      }),
    );

    execFileSync(
      'bash',
      [
        '-c',
        `PATH="${repo.binDir}${nodePath.delimiter}$PATH" ` +
          `GH_FAKE_STATE="${repo.stateFile}" ` +
          `gh api 'repos/test/repo/issues/42/timeline'`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    const state = repo.readState();
    expect(state.issues['42']._label_names).toContain('rule-A');
    expect(state.issues['42']._label_names).toContain('rule-B');
  });

  it('consecutive requests fire rules at ordinal 1 then 2 (not 1 then 3)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        side_effects: [
          {
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42/timeline',
            on_nth: 1,
            timing: 'pre',
            action: 'add_label',
            issue: 42,
            label: 'first',
          },
          {
            method: 'GET',
            endpoint: 'repos/test/repo/issues/42/timeline',
            on_nth: 2,
            timing: 'pre',
            action: 'add_label',
            issue: 42,
            label: 'second',
          },
        ],
      }),
    );

    // First request — should fire rule "first" only
    execFileSync(
      'bash',
      [
        '-c',
        `PATH="${repo.binDir}${nodePath.delimiter}$PATH" ` +
          `GH_FAKE_STATE="${repo.stateFile}" ` +
          `gh api 'repos/test/repo/issues/42/timeline'`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let state = repo.readState();
    expect(state.issues['42']._label_names).toContain('first');
    expect(state.issues['42']._label_names).not.toContain('second');

    // Second request — should fire rule "second"
    execFileSync(
      'bash',
      [
        '-c',
        `PATH="${repo.binDir}${nodePath.delimiter}$PATH" ` +
          `GH_FAKE_STATE="${repo.stateFile}" ` +
          `gh api 'repos/test/repo/issues/42/timeline'`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    state = repo.readState();
    expect(state.issues['42']._label_names).toContain('second');
  });
});
