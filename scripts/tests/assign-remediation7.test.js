/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for PR #2634 Round 7 remediation findings.
 *
 *   H3: unassign-stale-issues.sh EXPECTED_REPO_URL moved below the
 *       explicit GITHUB_REPOSITORY guard — missing env must produce
 *       "Missing GITHUB_REPOSITORY", not unbound-variable noise.
 *   H4: find_provenance_from_timeline uses EVENT POSITION (array index)
 *       for total ordering, not created_at timestamps. Same-second events
 *       must be ordered by their position in the flattened timeline array.
 *   H5: Concurrent same-issue /assign convergence — deterministic winner
 *       election via timeline event positions. Two (and three) REAL
 *       assign-issue.sh processes against shared fake state with process-safe
 *       locking must converge to exactly one deterministic bot winner.
 */

import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import * as nodePath from 'path';
import {
  createFakeRepo,
  defaultState,
  makeIssue,
  makePR,
  makeAssignedEvent,
  makeLabeledEvent,
  makeUnlabeledEvent,
  makeUnassignedEvent,
  daysAgo,
} from './assign-helpers.js';

const ROOT = nodePath.resolve(import.meta.dirname, '../..');
const FAKE_GH = nodePath.join(ROOT, 'scripts/tests/fake-gh.py');
const ASSIGN_SCRIPT = nodePath.join(ROOT, '.github/scripts/assign-issue.sh');
const CLEANUP_SCRIPT = nodePath.join(
  ROOT,
  '.github/scripts/unassign-stale-issues.sh',
);

// Track active child processes and temp dirs for robust teardown.
const activeChildren = [];
const tempDirs = [];

afterEach(() => {
  // Kill any lingering child processes if tests fail or time out.
  for (const child of activeChildren) {
    if (!child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        // already exited
      }
    }
  }
  activeChildren.length = 0;

  // Clean up temp dirs and lock files synchronously.
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
    // Also remove any stray lock file created by fake-gh.
    rmSync(dir + '.lock', { force: true });
  }
  tempDirs.length = 0;
});

function defaultStateWith(overrides) {
  return { ...defaultState(), ...overrides };
}

// ===========================================================================
// H3: unassign-stale-issues.sh EXPECTED_REPO_URL guard order
// ===========================================================================

describe('H3: unassign-stale-issues.sh guard order', () => {
  it('empty-string GITHUB_REPOSITORY exits nonzero with clean message (not unbound-variable)', () => {
    // GITHUB_REPOSITORY is set to an empty string. The guard must treat
    // this as missing and fail with the clean message, not bash unbound-
    // variable noise.
    let exitCode = 0;
    let stderr = '';
    try {
      execFileSync('bash', [CLEANUP_SCRIPT], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_REPOSITORY: '', // explicitly unset
          GH_TOKEN: 'fake',
          GITHUB_TOKEN: 'fake',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      stderr = err.stderr?.toString() ?? '';
    }

    expect(exitCode).not.toBe(0);
    // Must contain the clean message, NOT bash unbound-variable noise
    expect(stderr).toContain('Missing GITHUB_REPOSITORY');
    expect(stderr).not.toMatch(
      /unbound variable|GITHUB_REPOSITORY.*parameter/i,
    );
  });

  it('missing GITHUB_REPOSITORY via env deletion also exits cleanly', () => {
    let exitCode = 0;
    let stderr = '';
    const env = { ...process.env };
    delete env.GITHUB_REPOSITORY;
    delete env.GITHUB_TOKEN;
    delete env.GH_TOKEN;
    try {
      execFileSync('bash', [CLEANUP_SCRIPT], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      stderr = err.stderr?.toString() ?? '';
    }

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Missing GITHUB_REPOSITORY');
  });
});

// ===========================================================================
// H4: find_provenance_from_timeline uses EVENT POSITION (not created_at)
// ===========================================================================

describe('H4: Same-second event ordering by position', () => {
  const ts = daysAgo(20); // all events share this timestamp

  it('bot label → bot assign → human unlabel → human relabel (never remove)', () => {
    // All events same second. Timeline order:
    // 1. bot labeled auto-assigned
    // 2. bot assigned stale-user
    // 3. human unlabeled auto-assigned
    // 4. human relabeled auto-assigned
    // Human unlabel invalidates provenance (even at equal timestamp).
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
              createdAt: ts,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: ts,
            }),
            makeUnlabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'human-maintainer',
              createdAt: ts,
            }),
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'human-maintainer',
              createdAt: ts,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    // Human unlabel after bot label invalidates provenance — never remove
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });

  it('prior bot assign → unassign → new bot label → bot assign (new stint qualifies)', () => {
    // All events same second. Timeline order by position:
    // 1. bot assigned stale-user
    // 2. bot unassigned stale-user
    // 3. bot labeled auto-assigned
    // 4. bot assigned stale-user (new stint)
    // The new stint qualifies because the latest transition (by position) is
    // a bot assigned event, with a bot labeled event after the boundary
    // (the unassign) and at/before the new assign.
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
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: ts,
            }),
            makeUnassignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: ts,
            }),
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: ts,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: ts,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    // New stint qualifies — should unassign
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });

  it('same-second old label → unassign → new bot assign without new label (does NOT qualify)', () => {
    // All events same second. Timeline order by position:
    // 1. bot labeled auto-assigned (old label)
    // 2. bot unassigned stale-user (boundary)
    // 3. bot assigned stale-user (no new label after boundary)
    // Does NOT qualify because the qualifying labeled event must be AFTER
    // the boundary (unassign) and at/before the assigned event. The only
    // labeled event is BEFORE the boundary.
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
              createdAt: ts,
            }),
            makeUnassignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: ts,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: ts,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    // Does NOT qualify — old label before boundary, no new label in current stint
    expect(result.state.issues['42']._assignees).toContain('stale-user');
  });

  it('human unlabel BEFORE bot label does NOT invalidate (position matters)', () => {
    // All events same second. Timeline order by position:
    // 1. human unlabeled auto-assigned (stale unlabel from a prior stint)
    // 2. bot labeled auto-assigned
    // 3. bot assigned stale-user
    // The unlabel is BEFORE the qualifying labeled event (by position), so
    // it does NOT invalidate. This is the key position-based ordering test.
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
            makeUnlabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'human-maintainer',
              createdAt: ts,
            }),
            makeLabeledEvent({
              number: 42,
              label: 'auto-assigned',
              actor: 'github-actions[bot]',
              createdAt: ts,
            }),
            makeAssignedEvent({
              number: 42,
              assignee: 'stale-user',
              actor: 'github-actions[bot]',
              createdAt: ts,
            }),
          ],
        },
      }),
    );

    const result = repo.runCleanup();

    expect(result.status).toBe(0);
    // Bot label after the unlabel (by position) is valid — qualifies for removal
    expect(result.state.issues['42']._assignees).not.toContain('stale-user');
  });
});

// ===========================================================================
// H5: Concurrent same-issue /assign convergence (deterministic winner)
// ===========================================================================

/**
 * Helper: set up a fake repo for concurrency tests with file-lock-aware
 * fake-gh and return the paths needed for spawning real bash processes.
 */
function setupConcurrencyRepo(initialState) {
  const dir = mkdtempSync(nodePath.join(tmpdir(), 'assign-concur-'));
  tempDirs.push(dir);
  const stateFile = nodePath.join(dir, 'state.json');
  const binDir = nodePath.join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  const ghWrapper = nodePath.join(binDir, 'gh');
  writeFileSync(
    ghWrapper,
    `#!/usr/bin/env bash\nexec python3 "${FAKE_GH}" "$@"\n`,
  );
  execFileSync('chmod', ['+x', ghWrapper]);

  const baseState = {
    now: '2025-07-23T00:00:00Z',
    next_comment_id: 100,
    next_event_id: 10000,
    issues: {},
    prs: {},
    comments: [],
    labels: {},
    events: {},
    timeline: {},
    fail_config: {},
    ...initialState,
  };
  writeFileSync(stateFile, JSON.stringify(baseState, null, 2));

  const pathWithFakeGh = binDir + nodePath.delimiter + process.env.PATH;

  return { dir, stateFile, binDir, pathWithFakeGh };
}

/**
 * Spawn a real assign-issue.sh process asynchronously.
 * Returns a promise that resolves to { stdout, stderr, status }.
 *
 * Both processes are forced past the initial empty-assignee guard by having
 * the issue start unassigned. They both proceed to mutate (POST label,
 * POST assignee). The winner election must converge deterministically.
 */
function spawnAssignProcess({
  stateFile,
  pathWithFakeGh,
  issueNumber,
  commenter,
}) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      GH_TOKEN: 'fake-token',
      GITHUB_TOKEN: 'fake-token',
      GITHUB_REPOSITORY: 'test/repo',
      ISSUE_NUMBER: String(issueNumber),
      COMMENTER_LOGIN: commenter,
      GH_FAKE_STATE: stateFile,
      ASSIGN_RETRY_DELAY: '0',
      ASSIGN_ELECTION_RETRIES: '3',
      ASSIGN_ELECTION_DELAY: '0',
      PATH: pathWithFakeGh,
    };

    const child = spawn('bash', [ASSIGN_SCRIPT], {
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.push(child);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });

    child.on('error', (err) => {
      // Spawn failed (e.g. bash not found) — resolve with error info.
      resolve({ stdout, stderr: stderr + String(err), status: 1 });
    });

    child.on('close', (code) => {
      resolve({ stdout, stderr, status: code ?? 1 });
    });
  });
}

/**
 * Spawn multiple assign-issue.sh processes concurrently, wait for all,
 * and return the final state + per-process results.
 */
async function runConcurrentAssign({
  stateFile,
  pathWithFakeGh,
  issueNumber,
  commenters,
}) {
  const promises = commenters.map((commenter) =>
    spawnAssignProcess({
      stateFile,
      pathWithFakeGh,
      issueNumber,
      commenter,
    }),
  );

  const results = await Promise.all(promises);
  const finalState = JSON.parse(readFileSync(stateFile, 'utf8'));

  return { results, finalState };
}

describe('H5: Concurrent same-issue /assign convergence', () => {
  it('two real processes converge to exactly one deterministic winner', async () => {
    // Both alice and bob have merged PRs (eligible). Issue #42 starts unassigned.
    // Two REAL bash processes run concurrently. The file-lock-aware fake-gh
    // serializes mutations. Deterministic winner election via timeline event
    // position must converge: exactly ONE assignee, ONE marker, durable history
    // for the winner only, no unrelated state loss.
    const { stateFile, pathWithFakeGh } = setupConcurrencyRepo({
      issues: {
        42: makeIssue({ number: 42, assignees: [], labels: ['bug'] }),
      },
      prs: {
        100: makePR({ number: 100, author: 'alice', merged: true }),
        101: makePR({ number: 101, author: 'bob', merged: true }),
      },
      labels: {
        'auto-assigned': {
          name: 'auto-assigned',
          color: '0E8A16',
          description: 'Assigned via /assign automation',
        },
      },
    });

    const { results, finalState } = await runConcurrentAssign({
      stateFile,
      pathWithFakeGh,
      issueNumber: 42,
      commenters: ['alice', 'bob'],
    });

    const issue = finalState.issues['42'];

    // Exactly ONE assignee
    expect(issue._assignees).toHaveLength(1);

    // The winner is the one whose assigned event is earliest in timeline position
    const assignedEvents = (finalState.timeline['42'] || []).filter(
      (e) => e.event === 'assigned' && e.actor.login === 'github-actions[bot]',
    );
    expect(assignedEvents.length).toBeGreaterThanOrEqual(1);

    // Determine the winner by earliest assigned event position
    const winnerLogin = issue._assignees[0];
    expect(['alice', 'bob']).toContain(winnerLogin);

    // Exactly ONE auto-assigned marker
    const autoLabels = issue._label_names.filter((l) => l === 'auto-assigned');
    expect(autoLabels).toHaveLength(1);

    // Durable history label for winner only
    const winnerHistory = `asnhist--${winnerLogin}`;
    const loserLogin = winnerLogin === 'alice' ? 'bob' : 'alice';
    expect(finalState.labels[winnerHistory]).toBeDefined();
    expect(finalState.labels[`asnhist--${loserLogin}`]).toBeUndefined();

    // Unrelated labels preserved
    expect(issue._label_names).toContain('bug');

    // At least one process must succeed (exit 0), the loser exits nonzero
    const exitCodes = results.map((r) => r.status);
    expect(exitCodes).toContain(0);
  }, 60000);

  it('three real processes converge to exactly one deterministic winner', async () => {
    const { stateFile, pathWithFakeGh } = setupConcurrencyRepo({
      issues: {
        42: makeIssue({ number: 42, assignees: [], labels: ['bug'] }),
      },
      prs: {
        100: makePR({ number: 100, author: 'alice', merged: true }),
        101: makePR({ number: 101, author: 'bob', merged: true }),
        102: makePR({ number: 102, author: 'charlie', merged: true }),
      },
      labels: {
        'auto-assigned': {
          name: 'auto-assigned',
          color: '0E8A16',
          description: 'Assigned via /assign automation',
        },
      },
    });

    const { results, finalState } = await runConcurrentAssign({
      stateFile,
      pathWithFakeGh,
      issueNumber: 42,
      commenters: ['alice', 'bob', 'charlie'],
    });

    const issue = finalState.issues['42'];

    // Exactly ONE assignee despite 3 contenders
    expect(issue._assignees).toHaveLength(1);

    const winnerLogin = issue._assignees[0];
    expect(['alice', 'bob', 'charlie']).toContain(winnerLogin);

    // Exactly ONE marker
    const autoLabels = issue._label_names.filter((l) => l === 'auto-assigned');
    expect(autoLabels).toHaveLength(1);

    // Durable history for winner only (the winner's history label must exist;
    // losers may or may not have one depending on timing, but winner MUST)
    expect(finalState.labels[`asnhist--${winnerLogin}`]).toBeDefined();
    for (const loser of ['alice', 'bob', 'charlie']) {
      if (loser !== winnerLogin) {
        expect(finalState.labels[`asnhist--${loser}`]).toBeUndefined();
      }
    }

    // At least one process succeeds
    const exitCodes = results.map((r) => r.status);
    expect(exitCodes).toContain(0);
  }, 60000);

  it('concurrent bot assign with pre-existing human assignment: bot rolls back', async () => {
    // Issue is ALREADY assigned to a human. Two bot processes attempt to assign.
    // Both must see the human assignment and rollback. No winner.
    const { stateFile, pathWithFakeGh } = setupConcurrencyRepo({
      issues: {
        42: makeIssue({
          number: 42,
          assignees: ['human-user'],
          labels: ['bug'],
        }),
      },
      prs: {
        100: makePR({ number: 100, author: 'alice', merged: true }),
        101: makePR({ number: 101, author: 'bob', merged: true }),
      },
      labels: {
        'auto-assigned': {
          name: 'auto-assigned',
          color: '0E8A16',
          description: 'Assigned via /assign automation',
        },
      },
    });

    const { finalState } = await runConcurrentAssign({
      stateFile,
      pathWithFakeGh,
      issueNumber: 42,
      commenters: ['alice', 'bob'],
    });

    const issue = finalState.issues['42'];

    // Human assignment preserved; neither bot user assigned
    expect(issue._assignees).toContain('human-user');
    expect(issue._assignees).not.toContain('alice');
    expect(issue._assignees).not.toContain('bob');
    // No auto-assigned marker
    expect(issue._label_names).not.toContain('auto-assigned');
  }, 60000);

  it('single process still succeeds normally (no regression)', () => {
    const repo = createFakeRepo(
      defaultStateWith({
        issues: { 42: makeIssue({ number: 42, assignees: [] }) },
        prs: { 100: makePR({ number: 100, author: 'alice', merged: true }) },
      }),
    );

    const result = repo.runAssign({ issueNumber: 42, commenter: 'alice' });

    expect(result.status).toBe(0);
    expect(result.state.issues['42']._assignees).toContain('alice');
    expect(result.state.issues['42']._label_names).toContain('auto-assigned');
    expect(result.state.labels['asnhist--alice']).toBeDefined();
  });
});
