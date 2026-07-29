/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 new review findings (round 8).
 * Part B: describe blocks F6, F8, F14 — split from
 * assign-remediation8.test.ts to satisfy the 800line limit.
 *
 * These execute the REAL bash scripts against the fake gh infrastructure.
 */

import { describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, rmSync } from 'fs';
import * as nodePath from 'path';
import { asRecord, stateIssue, stateOpLog } from './typed-test-helpers.ts';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  makeFillerEvents,
  daysAgo,
  failOnNth,
} from './assign-helpers.ts';

function defaultStateWith(overrides: Record<string, unknown>) {
  return { ...defaultState(), ...overrides };
}

function waitForHook(hookFile: string, child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`Timed out waiting for signal hook: ${hookFile}`));
    }, 5000);
    const poll = setInterval(() => {
      if (existsSync(hookFile)) {
        clearInterval(poll);
        clearTimeout(timeout);
        resolve();
        return;
      }
      if (child.exitCode !== null || child.signalCode !== null) {
        clearInterval(poll);
        clearTimeout(timeout);
        reject(
          new Error('Assignment script exited before creating signal hook'),
        );
      }
    }, 10);
  });
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code !== null) {
        resolve(code);
        return;
      }
      reject(new Error(`Assignment script exited from signal ${signal}`));
    });
  });
}

// ===========================================================================
// Finding 6: Bounded retry around cleanup timeline GETs
// ===========================================================================

describe('F6: bounded retry around cleanup timeline GETs', () => {
  it('timeline GET fails then succeeds on retry (with zero delay)', () => {
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
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: assignedAt,
            }),
          ],
        },
        fail_config: failOnNth({
          method: 'GET',
          endpoint: 'repos/test/repo/issues/42/timeline',
          on_nth: 1,
          type: 'error',
        }),
      }),
    );

    const result = repo.runCleanup({ extraEnv: { ASSIGN_RETRY_DELAY: '0' } });

    expect(result.status).toBe(0);
    expect(stateIssue(result.state, '42')._assignees).not.toContain(
      'stale-user',
    );
  });

  it('timeline GET exhausted retries fails closed (with zero delay)', () => {
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

    const result = repo.runCleanup({ extraEnv: { ASSIGN_RETRY_DELAY: '0' } });

    expect(result.status).not.toBe(0);
    expect(stateIssue(result.state, '42')._assignees).toContain('stale-user');
  });
});

// ===========================================================================
// Finding 8: Deterministic event IDs
// ===========================================================================

describe('F8: deterministic event IDs do not collide with filler range', () => {
  it('event IDs from helpers are > 200000 and do not collide with filler IDs', () => {
    const fillers = makeFillerEvents(10);
    const event = makeAssignedEvent({
      assignee: 'test-user',
      actor: 'github-actions[bot]',
    });

    const fillerIds = fillers.map((f) => f.id);
    expect(event.id).toBeGreaterThan(200000);

    expect(fillerIds).not.toContain(event.id);
  });
});

// ===========================================================================
// Finding 14: fake-gh label filter ALL-label subset semantics
// ===========================================================================

describe('F14: fake-gh label filter ALL-label subset', () => {
  it('issues listing requires ALL requested labels (subset match)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: {
          1: makeIssue({
            number: 1,
            assignees: [],
            labels: ['auto-assigned', 'bug'],
          }),
          2: makeIssue({
            number: 2,
            assignees: [],
            labels: ['auto-assigned'],
          }),
          3: makeIssue({
            number: 3,
            assignees: [],
            labels: ['bug'],
          }),
        },
      }),
    );

    repo.updateState((s) => {
      s['page_size'] = 100;
    });

    const result = execFileSync(
      'bash',
      [
        '-c',
        `PATH="${repo.binDir}${nodePath.delimiter}$PATH" GH_FAKE_STATE="${repo.stateFile}" ` +
          `gh api 'repos/test/repo/issues?state=open&labels=auto-assigned,bug&per_page=100' --paginate`,
      ],
      { encoding: 'utf8' },
    );

    const issues = JSON.parse(result);
    expect(issues.length).toBe(1);
    expect(issues[0].number).toBe(1);
  });

  describe('ownership-aware assignment rollback', () => {
    it('never deletes a same-login human assignment made during label POST', () => {
      const repo = createFakeRepo(
        defaultStateWith({
          issues: { 42: makeIssue({ number: 42, assignees: [] }) },
          prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
          side_effects: [
            {
              method: 'POST',
              endpoint: 'repos/test/repo/issues/42/labels',
              on_nth: 1,
              action: 'add_assignee',
              issue: 42,
              assignee: 'alice',
              actor: 'maintainer',
            },
          ],
        }),
      );

      const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

      expect(result.status).not.toBe(0);
      expect(stateIssue(result.state, '42')._assignees).toContain('alice');
      expect(stateIssue(result.state, '42')._label_names).not.toContain(
        'auto-assigned',
      );
      expect(
        (stateOpLog(result.state) ?? []).filter(
          (op: Record<string, unknown>) =>
            op['method'] === 'DELETE' &&
            op['endpoint'] === 'repos/test/repo/issues/42/assignees',
        ),
      ).toHaveLength(0);
    });

    it('rolls back an assignee POST that applied before returning an error', () => {
      const repo = createFakeRepo(
        defaultStateWith({
          issues: { 42: makeIssue({ number: 42, assignees: [] }) },
          prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
          fail_config: failOnNth({
            method: 'POST',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            type: 'applied_error',
          }),
        }),
      );

      const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

      expect(result.status).not.toBe(0);
      expect(stateIssue(result.state, '42')._assignees).not.toContain('alice');
      expect(stateIssue(result.state, '42')._label_names).not.toContain(
        'auto-assigned',
      );
    });

    it('preserves a human same-login takeover after an ambiguous applied POST', () => {
      const repo = createFakeRepo(
        defaultStateWith({
          issues: { 42: makeIssue({ number: 42, assignees: [] }) },
          prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
          fail_config: failOnNth({
            method: 'POST',
            endpoint: 'repos/test/repo/issues/42/assignees',
            on_nth: 1,
            type: 'applied_error',
          }),
          side_effects: [
            {
              method: 'POST',
              endpoint: 'repos/test/repo/issues/42/assignees',
              on_nth: 1,
              timing: 'post',
              action: 'unassign_reassign',
              issue: 42,
              assignee: 'alice',
              actor: 'maintainer',
            },
          ],
        }),
      );

      const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

      expect(result.status).not.toBe(0);
      expect(stateIssue(result.state, '42')._assignees).toContain('alice');
      expect(stateIssue(result.state, '42')._label_names).not.toContain(
        'auto-assigned',
      );
      expect(
        (stateOpLog(result.state) ?? []).filter(
          (op: Record<string, unknown>) =>
            op['method'] === 'DELETE' &&
            op['endpoint'] === 'repos/test/repo/issues/42/assignees',
        ),
      ).toHaveLength(0);
    });
  });

  describe('cleanup same-login takeover compensation', () => {
    it('restores a human takeover detected after targeted DELETE and retains marker', () => {
      const assignedAt = daysAgo(20);
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
      expect(stateIssue(result.state, '42')._assignees).toEqual(
        expect.arrayContaining(['stale-user', 'co-owner']),
      );
      expect(stateIssue(result.state, '42')._label_names).toEqual(
        expect.arrayContaining(['auto-assigned', 'bug']),
      );
      expect(
        (stateOpLog(result.state) ?? []).filter(
          (op: Record<string, unknown>) =>
            op['method'] === 'POST' &&
            op['endpoint'] === 'repos/test/repo/issues/42/assignees',
        ),
      ).toHaveLength(1);
    });
  });

  describe('assignment signal lifecycle', () => {
    it(
      'rolls back bot-owned mutations when TERM arrives after assignee mutation',
      { timeout: 30000 },
      async () => {
        const hookFile = nodePath.join(
          process.cwd(),
          'tmp',
          `assign-signal-${process.pid}`,
        );
        const repo = createFakeRepo(
          defaultStateWith({
            issues: { 42: makeIssue({ number: 42, assignees: [] }) },
            prs: {
              100: makePR({ number: 100, author: 'alice', merged: true }),
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
        };

        rmSync(hookFile, { force: true });
        const child = spawn('bash', [assignScript], { env, stdio: 'ignore' });
        const exit = waitForExit(child);
        let status = 0;
        try {
          await waitForHook(hookFile, child);
          expect(child.kill('SIGTERM')).toBe(true);
          status = await exit;
        } finally {
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL');
          }
        }

        const state = repo.readState();
        expect(status).not.toBe(0);
        const issue42 = asRecord(state.issues['42']);
        expect(issue42._assignees).not.toContain('alice');
        expect(issue42._label_names).not.toContain('auto-assigned');
      },
    );
  });
});
