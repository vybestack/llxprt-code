/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 Round 5 remediation findings.
 * Part B: describe blocks G3, G4, G5 — split from
 * assign-remediation5.test.ts to satisfy the 800line limit.
 *
 * These execute the REAL bash scripts against the fake gh infrastructure.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import * as nodePath from 'path';
import { asRecord, stateIssue } from './typed-test-helpers.ts';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makeAssignedEvent,
  makeLabeledEvent,
  daysAgo,
  failOnNth,
} from './assign-helpers.ts';

function defaultStateWith(overrides: Record<string, unknown>) {
  return { ...defaultState(), ...overrides };
}

// ===========================================================================
// G3: Cleanup validates auto-assigned label definition upfront
// ===========================================================================

describe('G3: Cleanup validates auto-assigned label definition upfront', () => {
  it('missing auto-assigned label is a clean no-op', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        labels: {},
        issues: {},
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
  });

  it('conflicting auto-assigned definition fails with no mutation', () => {
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: 'FF0000',
            description: 'Human label',
          },
        },
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

    expect(result.status).not.toBe(0);
    expect(stateIssue(result.state, '42')._assignees).toContain('stale-user');
    expect(stateIssue(result.state, '42')._label_names).toContain(
      'auto-assigned',
    );
  });

  it('conflicting definition on unassigned issue fails with no mutation', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: '0000FF',
            description: 'Assigned via /assign automation',
          },
        },
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

    expect(result.status).not.toBe(0);
    expect(stateIssue(result.state, '42')._label_names).toContain(
      'auto-assigned',
    );
  });

  it('conflicting definition on human-assigned issue fails with no mutation', () => {
    const assignedAt = daysAgo(20);
    const repo = createFakeRepo(
      defaultStateWith({
        labels: {
          'auto-assigned': {
            name: 'auto-assigned',
            color: '0E8A16',
            description: 'Wrong description',
          },
        },
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['human-user'],
            labels: ['auto-assigned'],
          }),
        },
        timeline: {
          42: [
            makeAssignedEvent({
              number: 42,
              assignee: 'human-user',
              actor: 'human-admin',
              createdAt: assignedAt,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(stateIssue(result.state, '42')._assignees).toContain('human-user');
    expect(stateIssue(result.state, '42')._label_names).toContain(
      'auto-assigned',
    );
  });

  it('marker-label GET failure exits nonzero with no mutation', () => {
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
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/labels/auto-assigned',
          on_nth: 1,
          type: 'error',
          http_status: 500,
        }),
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(stateIssue(result.state, '42')._assignees).toContain('stale-user');
    expect(stateIssue(result.state, '42')._label_names).toContain(
      'auto-assigned',
    );
  });
});

// ===========================================================================
// G4: fake-gh 404 on DELETE of non-attached label; cleanup race resilience
// ===========================================================================

describe('G4: fake-gh 404 label DELETE + cleanup race resilience', () => {
  it('fake-gh: DELETE of non-attached issue label returns 404', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['u'],
            labels: ['bug'],
          }),
        },
      }),
    );

    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync(
        'bash',
        [
          '-c',
          `PATH="${repo.binDir}${nodePath.delimiter}$PATH" GH_FAKE_STATE="${repo.stateFile}" ` +
            `gh api --method DELETE 'repos/test/repo/issues/42/labels/nonexistent' --silent`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch (err: unknown) {
      const errRecord = asRecord(err);
      exitCode =
        typeof errRecord['status'] === 'number' ? errRecord['status'] : 1;
      stderr =
        typeof errRecord['stderr'] === 'string'
          ? errRecord['stderr']
          : (errRecord['stderr']?.toString() ?? '');
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/404/);
  });

  it('cleanup race: label removed after read but before DELETE succeeds cleanly', () => {
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
            endpoint: 'repos/test/repo/issues/42',
            on_nth: 2,
            action: 'remove_label',
            issue: 42,
            label: 'auto-assigned',
          },
        ],
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    expect(stateIssue(result.state, '42')._assignees).not.toContain(
      'stale-user',
    );
    expect(stateIssue(result.state, '42')._label_names).not.toContain(
      'auto-assigned',
    );
  });

  it('cleanup: targeted marker deletion persistent failure hits exact endpoint', () => {
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

    expect(stateIssue(result.state, '42')._assignees).not.toContain(
      'stale-user',
    );
    expect(result.status).not.toBe(0);
    expect(stateIssue(result.state, '42')._label_names).toContain(
      'auto-assigned',
    );
  });
});

// ===========================================================================
// G5: discover_candidates diagnostics
// ===========================================================================

describe('G5: discover_candidates failure diagnostics', () => {
  it('candidate discovery failure includes sanitized stderr in output', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {},
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/issues',
          on_nth: 1,
          type: 'error',
          http_status: 500,
        }),
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    const combined = (result.stderr || '') + (result.stdout || '');
    expect(combined).toMatch(/Server Error|status.*500/i);
  });

  it('candidate discovery failure does NOT return partial results', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          42: makeIssue({
            number: 42,
            assignees: ['stale-user'],
            labels: ['auto-assigned'],
          }),
        },
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/issues',
          on_nth: 1,
          type: 'error',
        }),
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).not.toBe(0);
    expect(stateIssue(result.state, '42')._assignees).toContain('stale-user');
  });
});
